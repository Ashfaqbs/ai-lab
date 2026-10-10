"""Pure trend-detection math: least-squares slope and linear projection over a
short rolling window of (timestamp, value) samples. No I/O, no Prometheus,
no Kubernetes -- kept separate so the actual proactive-vs-reactive decision
logic in agent.py can be tested without a live cluster."""


def linear_slope(samples: list[tuple[float, float]]) -> float:
    """Least-squares slope of value over time. Returns 0.0 for fewer than 2
    samples, or when all timestamps are identical (zero variance in time)."""
    n = len(samples)
    if n < 2:
        return 0.0

    timestamps = [s[0] for s in samples]
    values = [s[1] for s in samples]
    mean_t = sum(timestamps) / n
    mean_v = sum(values) / n

    numerator = sum((t - mean_t) * (v - mean_v) for t, v in zip(timestamps, values))
    denominator = sum((t - mean_t) ** 2 for t in timestamps)

    if denominator == 0:
        return 0.0
    return numerator / denominator


def project(current_value: float, slope: float, lookahead_seconds: float) -> float:
    """Projects the value `lookahead_seconds` into the future at the given slope."""
    return current_value + slope * lookahead_seconds
