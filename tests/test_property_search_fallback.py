import asyncio

from backend.agents.search import PropertySearchAgent


def test_search_agent_returns_fallback_results():
    agent = PropertySearchAgent()
    result = asyncio.run(agent.handle("this query matches nothing"))
    props = result["content"]["properties"]
    assert isinstance(props, list)
    assert len(props) > 0
