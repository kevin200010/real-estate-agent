from __future__ import annotations

from typing import Any, Dict

from .base import Agent


class QueryRouterAgent(Agent):
    """Classify incoming queries and dispatch to specialized agents."""

    _PROPERTY_KEYWORDS = {
        "property",
        "properties",
        "listing",
        "listings",
        "home",
        "house",
        "apartment",
        "condo",
    }
    _GREETING_KEYWORDS = {"hi", "hello", "hey"}

    def __init__(self, registry=None) -> None:
        super().__init__("QueryRouterAgent", registry)

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        q = query.lower()
        if any(word in q for word in self._PROPERTY_KEYWORDS):
            search_agent = self.registry.get("PropertySearchAgent")
            result = await search_agent.handle(query=query)
            result["source_agents"].insert(0, self.name)
            return result

        if any(word in q for word in self._GREETING_KEYWORDS):
            return {
                "result_type": "message",
                "content": (
                    "Hello! I can help you find properties. "
                    "Ask me about homes or listings."
                ),
                "source_agents": [self.name],
            }

        return {
            "result_type": "message",
            "content": "Sorry, I can't handle that request yet.",
            "source_agents": [self.name],
        }
