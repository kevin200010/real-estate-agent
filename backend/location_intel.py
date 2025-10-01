"""Utilities for gathering location intelligence for property records."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List

try:  # pragma: no cover - optional dependency when running tests
    from duckduckgo_search import DDGS
except ImportError:  # pragma: no cover - runtime fallback when package missing
    DDGS = None  # type: ignore


LOGGER = logging.getLogger(__name__)


async def fetch_location_references(query: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """Return a collection of public links that mention ``query``.

    The function prefers ``duckduckgo-search`` so we avoid API keys or paid
    plans.  When the dependency is unavailable or a network error occurs we
    degrade gracefully by returning an empty list.  Results are normalised to
    ``title``, ``url`` and ``snippet`` keys for consumption on the front end.
    """

    if not query:
        return []

    if DDGS is None:
        LOGGER.warning("duckduckgo-search is not installed; skipping location references")
        return []

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _search_duckduckgo, query, max_results)


def _search_duckduckgo(query: str, max_results: int) -> List[Dict[str, Any]]:
    """Blocking helper executed in a thread pool."""

    try:
        links: List[Dict[str, Any]] = []
        with DDGS(timeout=10) as search:
            for idx, result in enumerate(search.text(query, max_results=max_results)):
                if idx >= max_results:
                    break
                if not isinstance(result, dict):
                    continue
                href = result.get("href") or result.get("url")
                title = result.get("title") or result.get("heading") or href
                body = result.get("body") or result.get("snippet") or ""
                if not href:
                    continue
                links.append({
                    "title": str(title).strip() if title else href,
                    "url": str(href).strip(),
                    "snippet": str(body).strip(),
                })
        return links
    except Exception as exc:  # pragma: no cover - defensive network handling
        LOGGER.warning("Location intelligence lookup failed: %s", exc)
        return []

