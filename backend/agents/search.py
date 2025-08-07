from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Dict, List

from .base import Agent
from property_chatbot import PropertyRetriever


logger = logging.getLogger(__name__)


class PropertySearchAgent(Agent):
    """Retrieve property listings and format them as cards."""

    def __init__(self, data_file: Path | str, limit: int = 3, registry=None) -> None:
        super().__init__("PropertySearchAgent", registry)
        self.retriever = PropertyRetriever(data_file)
        self.limit = limit

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        logger.debug("Searching properties for query: %s", query)
        try:
            listings: List[Dict[str, Any]] = await asyncio.to_thread(
                self.retriever.search, query, self.limit
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("PropertySearchAgent failed")
            return {
                "result_type": "error",
                "content": str(exc),
                "source_agents": [self.name],
            }
        cards = [
            {
                "address": p.get("address") or p.get("location"),
                "price": p.get("price"),
                "description": p.get("description", ""),
                "image": p.get("image", "https://placehold.co/400x300"),
            }
            for p in listings
        ]
        return {
            "result_type": "property_cards",
            "content": cards,
            "source_agents": [self.name],
        }
