from __future__ import annotations

from typing import Any, Dict

from .base import Agent


class QueryRouterAgent(Agent):
    """Dispatch queries to other agents based on detected intent."""

    def __init__(self, registry=None) -> None:
        super().__init__("QueryRouterAgent", registry)

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        print(f"QueryRouterAgent triggered with query: {query}")
        classifier = self.registry.get("IntentClassifierAgent")
        intent_res = await classifier.handle(query=query)
        intent = intent_res.get("content")

        if intent == "property_search":
            print("QueryRouterAgent dispatching to PropertySearchAgent")
            search_agent = self.registry.get("PropertySearchAgent")
            result = await search_agent.handle(query=query)
        else:
            print("QueryRouterAgent dispatching to RealEstateInfoAgent")
            info_agent = self.registry.get("RealEstateInfoAgent")
            result = await info_agent.handle(query=query)

        result["source_agents"].insert(0, self.name)
        return result
