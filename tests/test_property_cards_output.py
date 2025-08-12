import asyncio
import sys

sys.path.append('backend')
from langgraph_app import app_graph


def test_chat_response_includes_property_fields():
    result = asyncio.run(app_graph.ainvoke({'user_input': 'hello'}))
    assert 'reply' in result
    assert 'properties' in result
    assert isinstance(result['properties'], list)
