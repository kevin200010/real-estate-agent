from __future__ import annotations

"""LangGraph-powered multi-agent FastAPI app for real estate queries.

This module demonstrates how multiple specialized agents can be orchestrated
using LangGraph in a directed graph.  Each agent is represented as an async
function that returns a partial update to a shared state dictionary.  The
``/chat`` endpoint exposes the graph to external callers and returns a
standardized JSON payload with the combined results.
"""

from typing import Any, Dict, List, Optional, TypedDict

from fastapi import FastAPI
from pydantic import BaseModel
from langgraph.graph import StateGraph, END


class GraphState(TypedDict, total=False):
    """State object passed between agents in the LangGraph workflow."""

    user_input: str
    intent: str
    listings: List[Dict[str, Any]]
    public_records: Dict[str, Any]
    knowledge: Dict[str, Any]
    om_pdf_url: str
    schedule: Dict[str, Any]
    result_type: str
    content: Dict[str, Any]
    source_agents: List[str]


# ---------------------------------------------------------------------------
# Agent implementations
# ---------------------------------------------------------------------------


async def query_router_agent(state: GraphState) -> GraphState:
    """Rudimentary intent classifier to route user queries.

    The router looks for simple keywords in the user input to determine the
    next step in the workflow.
    """

    text = state["user_input"].lower()
    if "schedule" in text:
        intent = "schedule"
    elif "om" in text or "memorandum" in text:
        intent = "generate_om"
    else:
        intent = "search"
    return {
        "intent": intent,
        "source_agents": state.get("source_agents", []) + ["query_router"],
    }


async def property_search_agent(state: GraphState) -> GraphState:
    """Fetch property listings from commercial real-estate websites.

    This is a placeholder implementation that returns a mock listing. In a
    production system this function would scrape LoopNet/Crexi/Brevitas or use
    their APIs.
    """

    listings = [
        {
            "id": "123",
            "address": "123 Main St, Miami, FL",
            "price": "$1,000,000",
        }
    ]
    return {
        "listings": listings,
        "source_agents": state.get("source_agents", []) + ["property_search"],
    }


async def public_record_agent(state: GraphState) -> GraphState:
    """Fetch public record information from miamidade.gov.

    The current implementation returns mocked data. Replace with real HTTP
    requests as needed.
    """

    records = {"123": {"owner": "John Doe", "taxes": "$10,000"}}
    return {
        "public_records": records,
        "source_agents": state.get("source_agents", []) + ["public_record"],
    }


async def knowledge_agent(state: GraphState) -> GraphState:
    """Embed and retrieve property information using ChromaDB.

    For demonstration purposes the agent only echoes back the listings. The
    ChromaDB integration would normally store and query embeddings here.
    """

    knowledge = {"retrieved": state.get("listings", [])}
    return {
        "knowledge": knowledge,
        "source_agents": state.get("source_agents", []) + ["knowledge"],
    }


async def om_generator_agent(state: GraphState) -> GraphState:
    """Generate an Offering Memorandum PDF based on search results.

    The real implementation would fill a PDF template with property details.
    Here we simply return a dummy URL.
    """

    pdf_url = "https://example.com/files/om_dummy.pdf"
    return {
        "om_pdf_url": pdf_url,
        "source_agents": state.get("source_agents", []) + ["om_generator"],
    }


async def scheduler_agent(state: GraphState) -> GraphState:
    """Book a property tour using the Google Calendar API.

    Only a mock event is created here to illustrate the flow.
    """

    event = {"id": "evt_123", "status": "confirmed"}
    return {
        "schedule": event,
        "source_agents": state.get("source_agents", []) + ["scheduler"],
    }


async def supervisor_agent(state: GraphState) -> GraphState:
    """Validate, merge, and finalize the response from prior agents."""

    content: Dict[str, Any] = {}
    result_parts: List[str] = []

    if state.get("listings"):
        content["cards"] = state["listings"]
        result_parts.append("property_cards")
    if state.get("om_pdf_url"):
        content["om_pdf_url"] = state["om_pdf_url"]
        result_parts.append("om_pdf")
    if state.get("schedule"):
        content["schedule"] = state["schedule"]
        result_parts.append("schedule")

    result_type = " + ".join(result_parts) if result_parts else "summary"

    return {
        "result_type": result_type,
        "content": content,
        "source_agents": state.get("source_agents", []) + ["supervisor"],
    }


# ---------------------------------------------------------------------------
# LangGraph workflow setup
# ---------------------------------------------------------------------------

workflow = StateGraph(GraphState)

workflow.add_node("query_router", query_router_agent)
workflow.add_node("property_search", property_search_agent)
workflow.add_node("public_record", public_record_agent)
workflow.add_node("knowledge", knowledge_agent)
workflow.add_node("om_generator", om_generator_agent)
workflow.add_node("scheduler", scheduler_agent)
workflow.add_node("supervisor", supervisor_agent)

workflow.set_entry_point("query_router")

# Routing after the query router
workflow.add_conditional_edges(
    "query_router",
    lambda s: s.get("intent"),
    {
        "search": "property_search",
        "generate_om": "property_search",  # search first then OM generation
        "schedule": "scheduler",
    },
)

# Common path for search/generate_om intents
workflow.add_edge("property_search", "public_record")
workflow.add_edge("public_record", "knowledge")

# After knowledge enrichment, decide whether to generate OM or finish
workflow.add_conditional_edges(
    "knowledge",
    lambda s: s.get("intent"),
    {
        "generate_om": "om_generator",
        "search": "supervisor",
    },
)

workflow.add_edge("om_generator", "supervisor")
workflow.add_edge("scheduler", "supervisor")
workflow.add_edge("supervisor", END)

app_graph = workflow.compile()


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI()


class ChatRequest(BaseModel):
    message: str


@app.post("/chat")
async def chat(req: ChatRequest) -> Dict[str, Any]:
    """Entry point for user interactions.

    The message is passed through the LangGraph workflow and the final state
    produced by the supervisor agent is returned to the caller.
    """

    initial_state: GraphState = {
        "user_input": req.message,
        "source_agents": [],
    }
    result = await app_graph.ainvoke(initial_state)
    # ``result`` is the final state. Only expose the standardized fields.
    return {
        "result_type": result.get("result_type", "summary"),
        "content": result.get("content", {}),
        "source_agents": result.get("source_agents", []),
    }
