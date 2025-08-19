import asyncio
import os
import sys

# Ensure repository root on path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from backend.agents.sql import SQLQueryGeneratorAgent


class DummyLLM:
    def generate_sql_query(self, request: str) -> str:
        return ""  # Force fallback logic


def test_all_properties_query_returns_all_rows():
    agent = SQLQueryGeneratorAgent(llm=DummyLLM())
    result = asyncio.run(agent.handle(query="show me all properties"))
    assert result["content"].strip().lower() == "select * from properties where 1=1 limit 10"
