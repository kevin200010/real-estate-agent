from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import logging

from .base import Agent
from ..sql_retriever import SQLPropertyRetriever


logger = logging.getLogger(__name__)


class SQLQueryGeneratorAgent(Agent):
    """Generate a SQL query based on a natural language request."""

    def __init__(self, limit: int = 5, registry=None) -> None:
        super().__init__("SQLQueryGeneratorAgent", registry)
        self.limit = limit

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        words = [w.lower() for w in query.split() if w]
        if words:
            conditions = " OR ".join(
                [
                    "LOWER(address) LIKE '%{w}%' OR LOWER(location) LIKE '%{w}%' OR LOWER(description) LIKE '%{w}%'".format(
                        w=w
                    )
                    for w in words
                ]
            )
        else:
            conditions = "1=1"
        sql_query = (
            "SELECT id, address, location, price, description, image FROM properties "
            f"WHERE {conditions} LIMIT {self.limit}"
        )
        return {
            "result_type": "sql_query",
            "content": sql_query,
            "source_agents": [self.name],
        }


class SQLQueryExecutorAgent(Agent):
    """Execute a SQL query against the properties database."""

    def __init__(self, data_file: Path | str, registry=None) -> None:
        super().__init__("SQLQueryExecutorAgent", registry)
        self.retriever = SQLPropertyRetriever(data_file)

    async def handle(self, sql_query: str, **_: Any) -> Dict[str, Any]:
        logger.info("Executing SQL query: %s", sql_query)
        try:
            cur = self.retriever.conn.execute(sql_query)
            rows = [dict(r) for r in cur.fetchall()]
            return {
                "result_type": "sql_results",
                "content": rows,
                "source_agents": [self.name],
            }
        except Exception as exc:  # pragma: no cover - defensive
            return {
                "result_type": "error",
                "content": str(exc),
                "source_agents": [self.name],
            }


class SQLValidatorAgent(Agent):
    """Validate the SQL query and results."""

    def __init__(self, registry=None) -> None:
        super().__init__("SQLValidatorAgent", registry)

    async def handle(
        self, sql_query: str, results: List[Dict[str, Any]], **_: Any
    ) -> Dict[str, Any]:
        is_valid = (
            sql_query.strip().lower().startswith("select")
            and "properties" in sql_query.lower()
            and bool(results)
        )
        return {
            "result_type": "validation",
            "content": is_valid,
            "source_agents": [self.name],
        }

