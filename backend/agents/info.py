from __future__ import annotations

import asyncio
from typing import Any, Dict

from .base import Agent
from property_chatbot import LLMClient


class RealEstateInfoAgent(Agent):
    """Answer general real-estate questions using an LLM."""

    def __init__(self, registry=None, llm: LLMClient | None = None) -> None:
        super().__init__("RealEstateInfoAgent", registry)
        self.llm = llm or LLMClient()

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        answer = await asyncio.to_thread(self.llm.answer_general, query)
        return {
            "result_type": "message",
            "content": answer,
            "source_agents": [self.name],
        }
