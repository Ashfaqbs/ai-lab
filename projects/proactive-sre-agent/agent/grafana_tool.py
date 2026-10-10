"""Reads a metric's current value from Prometheus.

This stands in for what a real Grafana MCP server's query tool (e.g. grafana/mcp-grafana's
query_prometheus) would return to an LLM reasoning step. See DECISIONS.md (2026-10-09,
"Phase 2 scope ruling") for why this agent calls Prometheus directly instead of standing
up a live MCP server + LLM loop: swapping this function's body for a real MCP tool call is
a contained follow-up, not a rewrite -- the caller in agent.py only needs a (timestamp,
value) pair back, regardless of where it came from."""

import time

import requests


def read_metric(prom_url: str, query: str, timeout: float = 5.0) -> float | None:
    """Returns the current value of an aggregating instant query, or None if the
    query matched no series (e.g. the metric hasn't been scraped yet)."""
    response = requests.get(
        f"{prom_url}/api/v1/query", params={"query": query}, timeout=timeout
    )
    response.raise_for_status()
    result = response.json()["data"]["result"]
    if not result:
        return None
    _, value = result[0]["value"]
    return float(value)


def now() -> float:
    return time.time()
