from __future__ import annotations

"""FastAPI service using LangGraph and Amazon Nova via Bedrock."""

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, TypedDict
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError, NoCredentialsError
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from langgraph.graph import StateGraph, END
from pydantic import BaseModel
from property_chatbot import PropertyRetriever
from appointments import GoogleCalendarClient

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


class LLMClient:
    """Small wrapper around an Amazon Nova model."""

    def __init__(self, model_id: str = "amazon.nova-lite-v1:0", region: str = "us-east-1"):
        self.client = boto3.client("bedrock-runtime", region_name=region)
        # Normalize model ID to avoid double-encoding of special characters like ':'
        # which would result in ``InvalidSignatureException`` errors from Bedrock.
        self.model_id = unquote(model_id)

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
    is_property_query: bool
    listings: List[Dict[str, Any]]
    answer: str
    reply: str
    properties: List[Dict[str, Any]]


retriever = PropertyRetriever(
    Path(__file__).resolve().parents[1] / "frontend" / "data" / "listings.csv"
)
llm_client = LLMClient()
_calendar = GoogleCalendarClient()


async def query_classifier_agent(state: GraphState) -> GraphState:
    logger.info("query_classifier_agent input: %s", state.get("user_input"))
    prompt = (
        "Does the following message ask about property listings or real estate? "
        "Respond only with 'yes' or 'no'.\n\n"
        f"Message: {state.get('user_input', '')}"
    )
    body = json.dumps(
        {
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {"maxTokens": 5, "temperature": 0},
        }
    )

    try:
        resp = llm_client.client.invoke_model(
            modelId=llm_client.model_id,
            body=body,
            contentType="application/json",
            accept="application/json",
        )
        data = json.loads(resp["body"].read())
        output = data["output"]["message"]["content"][0]["text"].strip().lower()
        is_query = output.startswith("y")
    except (KeyError, IndexError, TypeError, NoCredentialsError, ClientError) as exc:
        logger.warning("query_classifier_agent failed: %s", exc)
        is_query = False

    logger.info("query_classifier_agent result: %s", is_query)
    return {"is_property_query": is_query}


async def retrieve_agent(state: GraphState) -> GraphState:
    logger.info("retrieve_agent input: %s", state.get("user_input"))
    if not state.get("is_property_query"):
        logger.info("retrieve_agent skipping retrieval; not a property query")
        return {"listings": []}
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
            "id": p.get("id"),
            "image": p.get("image", "https://placehold.co/400x300"),
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
workflow.add_node("classify", query_classifier_agent)
workflow.add_node("retrieve", retrieve_agent)
workflow.add_node("llm", llm_agent)
workflow.add_node("format", format_agent)

workflow.set_entry_point("classify")
workflow.add_edge("classify", "retrieve")
workflow.add_edge("retrieve", "llm")
workflow.add_edge("llm", "format")
workflow.add_edge("format", END)

app_graph = workflow.compile()


app = FastAPI()


class ChatRequest(BaseModel):
    message: str


class AppointmentRequest(BaseModel):
    """Payload for booking a calendar slot."""

    name: str
    phone: str
    email: str
    date: str  # YYYY-MM-DD
    time: str  # e.g. "9:00 AM"


@app.post("/chat")
async def chat(req: ChatRequest) -> Dict[str, Any]:
    logger.info("/chat request: %s", req.message)
    initial_state: GraphState = {"user_input": req.message}
    result = await app_graph.ainvoke(initial_state)
    logger.info("/chat response: %s", result)
    return result


@app.get("/appointments")
async def list_appointments() -> List[Dict[str, Any]]:
    """Return upcoming appointments from the realtor's calendar."""

    return _calendar.list_events()


@app.post("/appointments")
async def book_appointment(payload: AppointmentRequest) -> Dict[str, Any]:
    """Book a new appointment on the realtor's calendar."""

    try:
        dt = datetime.strptime(
            f"{payload.date} {payload.time}", "%Y-%m-%d %I:%M %p"
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid date or time format")

    end = dt + timedelta(hours=1)
    description = f"Phone: {payload.phone}\nEmail: {payload.email}"
    summary = f"Appointment with {payload.name}"
    try:
        event = _calendar.create_event(summary, dt, end, description)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"event": event}

