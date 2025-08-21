from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import logging
import asyncio

from .base import Agent
try:  # pragma: no cover - allow use as package or script
    from ..sql_retriever import SQLPropertyRetriever
    from ..property_chatbot import LLMClient
except ImportError:  # fallback for running inside backend directory
    from sql_retriever import SQLPropertyRetriever
    from property_chatbot import LLMClient


logger = logging.getLogger(__name__)


class SQLQueryGeneratorAgent(Agent):
    """Generate a SQL query using an LLM with fallback heuristics."""

    def __init__(self, registry=None, llm: LLMClient | None = None) -> None:
        super().__init__("SQLQueryGeneratorAgent", registry)
        self.llm = llm or LLMClient()

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        q = query.strip()
        sql_query = ""
        if q:
            try:
                sql_query = await asyncio.to_thread(
                    self.llm.generate_sql_query, q
                )
            except Exception:
                sql_query = ""
        if not sql_query:
            esc = q.lower().replace("'", "''")
            if "all" in esc and "propert" in esc:
                conditions = "1=1"
            else:
                conditions = (
                    f"LOWER(address) LIKE '%{esc}%' "
                    f"OR LOWER(location) LIKE '%{esc}%' "
                    f"OR LOWER(description) LIKE '%{esc}%'"
                ) if q else "1=1"
            sql_query = (
                "SELECT * FROM properties "
                f"WHERE {conditions} LIMIT 10"
            )
        sql_query = self._strip_code_fences(sql_query)
        return {
            "result_type": "sql_query",
            "content": sql_query,
            "source_agents": [self.name],
        }

    @staticmethod
    def _strip_code_fences(query: str) -> str:
        query = query.strip()
        if query.startswith("```"):
            query = query[3:]
            if query.lower().startswith("sql"):
                query = query[3:]
            if query.startswith("\n"):
                query = query[1:]
            if query.endswith("```"):
                query = query[:-3]
        return query.strip()


class SQLQueryExecutorAgent(Agent):
    """Execute a SQL query against the properties database."""

    def __init__(self, data_file: Path | str, registry=None) -> None:
        super().__init__("SQLQueryExecutorAgent", registry)

        path = Path(data_file)
        if path.is_dir():
            for name in ("listings.csv", "listing.csv"):
                candidate = path / name
                if candidate.exists():
                    path = candidate
                    break
        elif not path.exists():
            alt = path.with_name(
                "listing.csv" if path.name == "listings.csv" else "listings.csv"
            )
            if alt.exists():
                path = alt

        self.retriever = SQLPropertyRetriever(path)

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

