from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict

from .base import Agent

try:  # pragma: no cover - handle both package and script imports
    from ..property_chatbot import LLMClient
except ImportError:  # fallback when running inside backend directory
    from property_chatbot import LLMClient


logger = logging.getLogger(__name__)


class RealEstateInfoAgent(Agent):
    """Answer general real-estate questions using an LLM."""

    def __init__(self, registry=None, llm: LLMClient | None = None) -> None:
        super().__init__("RealEstateInfoAgent", registry)
        self.llm = llm or LLMClient()

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        logger.debug("Handling info query: %s", query)
        print(f"RealEstateInfoAgent triggered with query: {query}")
        try:
            answer = await asyncio.to_thread(self.llm.answer_general, query)
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("RealEstateInfoAgent failed")
            return {
                "result_type": "error",
                "content": str(exc),
                "source_agents": [self.name],
            }
        return {
            "result_type": "message",
            "content": answer,
            "source_agents": [self.name],
        }
