from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

from .base import Agent

logger = logging.getLogger(__name__)


class CoordinatorAgent(Agent):
    """Coordinate multiple specialized agents and aggregate their output."""

    def __init__(self, agent_names: List[str], registry=None) -> None:
        super().__init__("CoordinatorAgent", registry)
        self.agent_names = agent_names

    async def _run_agent(self, agent: Agent, **kwargs: Any) -> Dict[str, Any]:
        try:
            logger.debug("Running agent %s", agent.name)
            print(f"CoordinatorAgent triggering {agent.name}")
            return await agent.handle(**kwargs)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Agent %s failed", agent.name)
            return {
                "result_type": "error",
                "content": str(exc),
                "source_agents": [agent.name],
            }

    async def handle(self, **kwargs: Any) -> Dict[str, Any]:
        tasks = []
        for name in self.agent_names:
            try:
                agent = self.registry.get(name)
            except KeyError:
                logger.error("Agent %s is not registered", name)
                continue
            tasks.append(self._run_agent(agent, **kwargs))

        results = await asyncio.gather(*tasks, return_exceptions=False)

        aggregated: Dict[str, Any] = {
            "result_type": "aggregate",
            "content": {},
            "source_agents": [self.name],
        }

        for res in results:
            rt = res.get("result_type")
            content = res.get("content")
            aggregated["source_agents"].extend(res.get("source_agents", []))

            if rt == "message":
                aggregated["content"].setdefault("messages", []).append(content)
            elif rt == "property_cards":
                aggregated["content"].setdefault("property_cards", []).extend(content)
            elif rt == "error":
                aggregated["content"].setdefault("errors", []).append(content)
            else:
                aggregated["content"].setdefault(rt or "unknown", []).append(content)

        return aggregated
