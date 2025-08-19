from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import logging

from .base import Agent
try:  # pragma: no cover - allow use as package or script
    from ..sql_retriever import SQLPropertyRetriever
except ImportError:  # fallback for running inside backend directory
    from sql_retriever import SQLPropertyRetriever


logger = logging.getLogger(__name__)


class SQLQueryGeneratorAgent(Agent):
    """Generate a simple SQL query without relying on an LLM."""

    def __init__(self, registry=None) -> None:
        super().__init__("SQLQueryGeneratorAgent", registry)

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        q = query.strip().lower()
        if q:
            esc = q.replace("'", "''")
            conditions = (
                f"LOWER(address) LIKE '%{esc}%' "
                f"OR LOWER(location) LIKE '%{esc}%' "
                f"OR LOWER(description) LIKE '%{esc}%'"
            )
        else:
            conditions = "1=1"
        sql_query = (
            "SELECT id, address, location, price, description, image, lat, lng FROM properties "
            f"WHERE {conditions}"
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

