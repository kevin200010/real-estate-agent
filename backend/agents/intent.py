from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Dict, List

from .base import Agent
from property_chatbot import PropertyRetriever


class IntentClassifierAgent(Agent):
    """Classify a user's query to decide if property search is needed.

    The agent uses the property retriever to see if any listings match the
    query once short, non-informative tokens are removed. If no listings are
    found the intent is considered ``general_info``. Otherwise the intent is
    ``property_search``.
    """

    def __init__(
        self, data_file: Path | str | None = None, limit: int = 1, registry=None
    ) -> None:
        super().__init__("IntentClassifierAgent", registry)
        if data_file is None:
            data_file = (
                Path(__file__).resolve().parents[2]
                / "frontend"
                / "data"
                / "listings.csv"
            )
        self.retriever = PropertyRetriever(data_file)
        self.limit = limit

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        print(f"IntentClassifierAgent triggered with query: {query}")
        # Remove very short tokens so greetings like "hi" don't match
        tokens = [t.rstrip("s") for t in query.lower().split() if len(t) >= 3]
        if not tokens:
            intent = "general_info"
        else:
            cleaned = " ".join(tokens)
            listings: List[Dict[str, Any]] = await asyncio.to_thread(
                self.retriever.search, cleaned, self.limit
            )
            intent = "property_search" if listings else "general_info"

        return {
            "result_type": "intent",
            "content": intent,
            "source_agents": [self.name],
        }

