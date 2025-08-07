from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional


class Agent(ABC):
    """Abstract base class for all agents in the system.

    Agents expose an asynchronous :meth:`handle` method that returns a
    standardized dictionary with ``result_type`` describing the kind of
    response, ``content`` holding the payload, and ``source_agents`` listing
    which agents produced the output.
    """

    def __init__(self, name: str, registry: Optional["AgentRegistry"] = None) -> None:
        self.name = name
        self.registry = registry

    @abstractmethod
    async def handle(self, **kwargs: Any) -> Dict[str, Any]:
        """Process a request and return a structured response."""
        raise NotImplementedError


class AgentRegistry:
    """Simple service locator used for agent coordination."""

    def __init__(self) -> None:
        self._agents: Dict[str, Agent] = {}

    def register(self, agent: Agent) -> None:
        agent.registry = self
        self._agents[agent.name] = agent

    def get(self, name: str) -> Agent:
        return self._agents[name]
