from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import csv
import json
import sqlite3
import logging
import asyncio

from .base import Agent
try:  # pragma: no cover - allow use as package or script
    from ..property_chatbot import LLMClient
except ImportError:  # fallback for running inside backend directory
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
        return {
            "result_type": "sql_query",
            "content": sql_query,
            "source_agents": [self.name],
        }


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

        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self._create_table()
        self._load_data(path)

    def _create_table(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS properties (
                id TEXT,
                address TEXT,
                location TEXT,
                price INTEGER,
                description TEXT,
                image TEXT,
                lat REAL,
                lng REAL
            )
            """
        )

    def _load_data(self, path: Path) -> None:
        if path.suffix.lower() == ".csv":
            with path.open("r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cleaned = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
                    self.conn.execute(
                        "INSERT INTO properties (id, address, location, price, description, image, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            cleaned.get("Listing Number"),
                            cleaned.get("Address"),
                            f"{cleaned.get('City', '')}, {cleaned.get('State', '')}".strip(", "),
                            self._parse_price(cleaned.get("List Price")),
                            cleaned.get("Property Subtype"),
                            cleaned.get("Image"),
                            self._parse_float(cleaned.get("Latitude")),
                            self._parse_float(cleaned.get("Longitude")),
                        ),
                    )
        else:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    self.conn.execute(
                        "INSERT INTO properties (id, address, location, price, description, image, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            item.get("id"),
                            item.get("address"),
                            item.get("location"),
                            item.get("price"),
                            item.get("description"),
                            item.get("image"),
                            self._parse_float(item.get("lat") or item.get("latitude")),
                            self._parse_float(item.get("lng") or item.get("longitude")),
                        ),
                    )
        self.conn.commit()

    @staticmethod
    def _parse_price(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        try:
            return int(float(str(value).replace("$", "").replace(",", "")))
        except ValueError:
            return None

    @staticmethod
    def _parse_float(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def _sanitize_query(sql_query: str) -> str:
        """Remove common formatting artifacts like code fences or leading labels."""
        q = sql_query.strip()
        if q.startswith("```"):
            q = q.strip("`")
            # remove optional language identifier
            if q.lower().startswith("sql"):
                q = q[3:]
            q = q.strip()
        if q.lower().startswith("sql\n"):
            q = q.split("\n", 1)[1]
        elif q.lower().startswith("sql "):
            q = q[3:]
        return q.strip()

    async def handle(self, sql_query: str, **_: Any) -> Dict[str, Any]:
        logger.info("Executing SQL query: %s", sql_query)
        cleaned = self._sanitize_query(sql_query)
        logger.debug("Sanitized SQL query: %s", cleaned)
        error = False
        try:
            cur = self.conn.execute(cleaned)
            rows = [dict(r) for r in cur.fetchall()]
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Query failed (%s); returning no results", exc)
            rows = []
            error = True

        if not rows and not error:
            fallback = "SELECT * FROM properties LIMIT 10"
            cur = self.conn.execute(fallback)
            rows = [dict(r) for r in cur.fetchall()]
            cleaned = fallback

        return {
            "result_type": "sql_results",
            "content": rows,
            "source_agents": [self.name],
            "sql_query": cleaned,
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

