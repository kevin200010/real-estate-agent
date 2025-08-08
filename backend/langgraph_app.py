from __future__ import annotations

"""FastAPI service using LangGraph and Amazon Nova via Bedrock."""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, TypedDict

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
from fastapi import FastAPI
from langgraph.graph import StateGraph, END
from pydantic import BaseModel

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def normalize_listing(p: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure common fields exist in property dictionaries."""

    return {
        **p,
        "address": p.get("address") or p.get("location", "Unknown location"),
        "bedrooms": p.get("bedrooms") or p.get("sqft") or "N/A",
    }


class PropertyRetriever:
    """Naive keyword search over local property data."""

    def __init__(self, data_file: Path | str):
        path = Path(data_file).resolve()
        try:
            with path.open("r", encoding="utf-8") as f:
                self.properties: List[Dict[str, Any]] = json.load(f)
        except FileNotFoundError:
            self.properties = []

    def search(self, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        q_words = query.lower().split()
        results: List[Dict[str, Any]] = []
        for p in self.properties:
            text = (
                f"{p.get('address', '')} {p.get('description', '')} "
                f"{p.get('type', '')}"
            ).lower()
            if all(word in text for word in q_words):
                results.append(p)
            if len(results) >= limit:
                break
        return results


class LLMClient:
    """Small wrapper around an Amazon Nova model."""

    def __init__(self, model_id: str = "amazon.nova-lite-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        self.model_id = model_id

    def answer(self, question: str, listings: List[Dict[str, Any]]) -> str:
        context_lines: List[str] = []
        for p in listings:
            location = p.get("address") or p.get("location", "Unknown location")
            bedrooms = p.get("bedrooms") or p.get("sqft") or "N/A"
            price = p.get("price", "N/A")
            description = p.get("description", "")
            context_lines.append(
                f"- {location} {price} {bedrooms} bedrooms. {description}"
            )
        context = "\n".join(context_lines) or "No listings matched."

        prompt = (
            "You are a helpful real-estate assistant. Answer the question using only "
            "the provided listings.\n\n"
            f"Listings:\n{context}\n\nQuestion: {question}"
        )

        body = json.dumps(
            {
                "messages": [{"role": "user", "content": [{"text": prompt}]}],
                "inferenceConfig": {"maxTokens": 256, "temperature": 0.7},
            }
        )

        try:
            resp = self.client.invoke_model(
                modelId=self.model_id,
                body=body,
                contentType="application/json",
                accept="application/json",
            )
            data = json.loads(resp["body"].read())
            return data["output"]["message"]["content"][0]["text"]
        except (KeyError, IndexError, TypeError):
            return "No answer found."
        except NoCredentialsError:
            return "Missing AWS credentials for Bedrock."
        except ClientError as exc:
            print("LLM invocation failed:", exc)
            return "Failed to generate an answer."


class GraphState(TypedDict, total=False):
    user_input: str
    listings: List[Dict[str, Any]]
    answer: str


retriever = PropertyRetriever(Path(__file__).with_name("rag_data.json"))
llm_client = LLMClient()


async def retrieve_agent(state: GraphState) -> GraphState:
    logger.info("retrieve_agent input: %s", state.get("user_input"))
    listings = retriever.search(state["user_input"])
    logger.info("retrieve_agent found %d listings", len(listings))
    return {"listings": [normalize_listing(p) for p in listings]}


async def llm_agent(state: GraphState) -> GraphState:
    logger.info(
        "llm_agent answering with %d listings", len(state.get("listings", []))
    )
    answer = llm_client.answer(state["user_input"], state.get("listings", []))
    logger.info("llm_agent output: %s", answer)
    return {"answer": answer}


async def format_agent(state: GraphState) -> GraphState:
    logger.info(
        "format_agent formatting %d listings", len(state.get("listings", []))
    )
    cards = [
        {
            "address": p.get("address"),
            "price": (
                f"${p.get('price'):,}"
                if isinstance(p.get("price"), (int, float))
                else p.get("price", "N/A")
            ),
            "description": p.get("description", ""),
        }
        for p in state.get("listings", [])
    ]
    logger.info("format_agent returning %d cards", len(cards))
    return {"reply": state.get("answer", ""), "properties": cards}


workflow = StateGraph(GraphState)
workflow.add_node("retrieve", retrieve_agent)
workflow.add_node("llm", llm_agent)
workflow.add_node("format", format_agent)

workflow.set_entry_point("retrieve")
workflow.add_edge("retrieve", "llm")
workflow.add_edge("llm", "format")
workflow.add_edge("format", END)

app_graph = workflow.compile()


app = FastAPI()


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
async def chat(req: ChatRequest) -> Dict[str, Any]:
    logger.info("/chat request: %s", req.message)
    initial_state: GraphState = {"user_input": req.message}
    result = await app_graph.ainvoke(initial_state)
    logger.info("/chat response: %s", result)
    return result

