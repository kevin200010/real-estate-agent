from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict

from .base import Agent

from .sql import (
    SQLQueryExecutorAgent,
    SQLQueryGeneratorAgent,
    SQLValidatorAgent,
)


logger = logging.getLogger(__name__)


class PropertySearchAgent(Agent):
    """Retrieve property listings and format them as cards."""

    def __init__(
        self, data_file: Path | str | None = None, registry=None
    ) -> None:
        """Create a search agent backed by the CSV listings dataset.

        ``data_file`` defaults to ``frontend/data/listings.csv`` so callers don't
        need to provide a path explicitly. This allows the agent to always search
        the full dataset shipping with the project.
        """

        super().__init__("PropertySearchAgent", registry)
        if data_file is None:
            data_file = (
                Path(__file__).resolve().parents[2]
                / "frontend"
                / "data"
                / "listings.csv"
            )
        self.generator = SQLQueryGeneratorAgent()
        self.executor = SQLQueryExecutorAgent(data_file)
        self.validator = SQLValidatorAgent()

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        logger.debug("Searching properties for query: %s", query)
        print(f"PropertySearchAgent triggered with query: {query}")
        try:
            gen_res = await self.generator.handle(query=query)
            sql_query = gen_res.get("content", "")
            exec_res = await self.executor.handle(sql_query=sql_query)
            listings = exec_res.get("content", [])
            val_res = await self.validator.handle(
                sql_query=sql_query, results=listings
            )
            if not val_res.get("content"):
                listings = []
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
        summary_parts = [
            f"{c['address']} for ${c['price']:,}" if isinstance(c.get("price"), (int, float)) else c['address']
            for c in listings
        ]
        message = (
            "Here are the top properties I found: " + ", ".join(summary_parts)
            if summary_parts
            else "No matching properties were found."
        )
        return {
            "result_type": "property_search",
            "content": {"message": message, "properties": cards},
            "source_agents": [self.name],
        }
