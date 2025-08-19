import asyncio
import os
import sys

# Ensure repository root on path
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

from backend.agents.sql import SQLQueryGeneratorAgent


class DummyLLM:
    def __init__(self):
        self.last_request = None

    def generate_sql_query(self, request: str) -> str:
        self.last_request = request
        return "SELECT * FROM properties"  # simple deterministic query


def test_generator_uses_llm():
    llm = DummyLLM()
    agent = SQLQueryGeneratorAgent(llm=llm)
    result = asyncio.run(agent.handle(query="beach house"))
    assert result["content"] == "SELECT * FROM properties"
    assert llm.last_request == "beach house"
