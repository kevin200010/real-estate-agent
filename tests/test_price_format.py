import asyncio
import sys
from pathlib import Path

import pytest

# Ensure the project root is on ``sys.path`` so the ``backend`` package can be
# imported when tests are executed from the ``tests`` directory.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.property_chatbot import _bot, process_user_query


def test_process_user_query_handles_missing_price(monkeypatch):
    """Listings lacking a price should not crash the request handler."""
    # Simulate retriever returning a listing without a price
    fake_listing = {"address": "123 Anywhere St", "price": None, "description": ""}
    monkeypatch.setattr(_bot.retriever, "search", lambda q, limit=3: [fake_listing])
    # Avoid invoking the real LLM which requires external credentials
    monkeypatch.setattr(_bot.llm, "answer", lambda question, listings: "ok")

    res = asyncio.run(process_user_query("property?"))
    assert res["properties"][0]["price"] == "N/A"
    assert res["reply"] == "ok"
