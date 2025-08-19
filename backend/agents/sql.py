from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
import json
import logging
from urllib.parse import unquote

import boto3
from botocore.exceptions import BotoCoreError, ClientError, NoCredentialsError

from .base import Agent
try:  # pragma: no cover - allow use as package or script
    from ..sql_retriever import SQLPropertyRetriever
except ImportError:  # fallback for running inside backend directory
    from sql_retriever import SQLPropertyRetriever


logger = logging.getLogger(__name__)


class SQLQueryGeneratorAgent(Agent):
    """Generate a SQL query based on a natural language request."""

    def __init__(
        self,
        registry=None,
        model_id: str = "amazon.nova-lite-v1:0",
        region: str = "us-east-1",
    ) -> None:
        super().__init__("SQLQueryGeneratorAgent", registry)
        # Attempt to create a Bedrock client for LLM-powered SQL generation.
        # If client creation fails we fall back to keyword search.
        try:
            self.client = boto3.client("bedrock-runtime", region_name=region)
            self.model_id = unquote(model_id)
            self.use_llm = True
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Falling back to heuristic SQL generation: %s", exc)
            self.client = None
            self.model_id = ""
            self.use_llm = False

    async def handle(self, query: str, **_: Any) -> Dict[str, Any]:
        sql_query = ""
        if self.use_llm:
            prompt = (
                "You are an assistant that writes SQLite SQL queries for a table "
                "'properties' with columns id, address, location, price, "
                "description, image, lat, lng. "
                f"Generate a SQL query that answers the user's request: {query}. "
                "Return only the SQL query."
            )
            body = json.dumps(
                {
                    "messages": [{"role": "user", "content": [{"text": prompt}]}],
                    "inferenceConfig": {"maxTokens": 256, "temperature": 0},
                }
            )
            try:
                resp = self.client.invoke_model(
                    modelId=self.model_id,
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
                data = json.loads(resp["body"].read())
                sql_query = (
                    data["output"]["message"]["content"][0]["text"]
                    .strip()
                    .split(";")[0]
                )
                logger.info("LLM-generated SQL query: %s", sql_query)
            except (
                KeyError,
                IndexError,
                TypeError,
                BotoCoreError,
                ClientError,
                NoCredentialsError,
            ) as exc:
                logger.warning("LLM SQL generation failed: %s", exc)
                self.use_llm = False

        if not sql_query:
            # Keyword-based fallback
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

