import asyncio
import os
import sys

# Ensure repository root on path so the ``backend`` package can be imported
sys.path.append(os.path.dirname(os.path.dirname(__file__)))
from backend.langgraph_app import app_graph


def test_chat_response_includes_property_fields():
    result = asyncio.run(app_graph.ainvoke({'user_input': 'hello'}))
    assert 'reply' in result
    assert 'properties' in result
    assert isinstance(result['properties'], list)
