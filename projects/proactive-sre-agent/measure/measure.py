"""Measures the lead time between a leading indicator and a lagging indicator
crossing their respective thresholds, by querying Prometheus's HTTP API directly."""

import argparse
import json
import sys

import requests


def query_range(
    prom_url: str, query: str, start: float, end: float, step: float
) -> list[tuple[float, float]]:
    """Runs a Prometheus range query and returns (timestamp, value) pairs for the
    first result series, or an empty list if the query matched no series."""
    response = requests.get(
        f"{prom_url}/api/v1/query_range",
        params={"query": query, "start": start, "end": end, "step": step},
        timeout=10,
    )
    response.raise_for_status()
    payload = response.json()
    results = payload.get("data", {}).get("result", [])
    if not results:
        return []
    return [(float(ts), float(value)) for ts, value in results[0]["values"]]


def first_crossing(series: list[tuple[float, float]], threshold: float) -> float | None:
    """Returns the timestamp of the first point where value >= threshold, or None."""
    for timestamp, value in series:
        if value >= threshold:
            return timestamp
    return None


def compute_lead_time(
    leading: list[tuple[float, float]],
    leading_threshold: float,
    lagging: list[tuple[float, float]],
    lagging_threshold: float,
) -> dict:
    """Computes how many seconds before the lagging indicator crossed its threshold
    the leading indicator crossed its own. Distinguishes "no data at all" from
    "data existed but never crossed", since both look like None otherwise."""
    if not leading or not lagging:
        return {"status": "no_data", "lead_time_seconds": None}

    leading_ts = first_crossing(leading, leading_threshold)
    lagging_ts = first_crossing(lagging, lagging_threshold)

    if leading_ts is None:
        return {"status": "leading_never_crossed", "lead_time_seconds": None}
    if lagging_ts is None:
        return {"status": "lagging_never_crossed", "lead_time_seconds": None}

    return {
        "status": "ok",
        "lead_time_seconds": lagging_ts - leading_ts,
        "leading_crossed_at": leading_ts,
        "lagging_crossed_at": lagging_ts,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prom-url", default="http://localhost:9090")
    parser.add_argument("--start", type=float, required=True)
    parser.add_argument("--end", type=float, required=True)
    parser.add_argument("--step", type=float, default=5.0)
    parser.add_argument("--leading-query", required=True)
    parser.add_argument("--leading-threshold", type=float, required=True)
    parser.add_argument("--lagging-query", required=True)
    parser.add_argument("--lagging-threshold", type=float, required=True)
    parser.add_argument("--output", default="measurement-report.json")
    args = parser.parse_args()

    leading = query_range(
        args.prom_url, args.leading_query, args.start, args.end, args.step
    )
    lagging = query_range(
        args.prom_url, args.lagging_query, args.start, args.end, args.step
    )

    result = compute_lead_time(
        leading, args.leading_threshold, lagging, args.lagging_threshold
    )
    result["leading_query"] = args.leading_query
    result["lagging_query"] = args.lagging_query

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result, indent=2))
    if result["status"] != "ok":
        sys.exit(1)


if __name__ == "__main__":
    main()
