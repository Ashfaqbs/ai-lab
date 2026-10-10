"""The proactive-vs-reactive decision logic: given a short history of a metric's
values, decide whether to act now, act because a trend will breach soon, or do
nothing. Kept free of Prometheus/Kubernetes I/O so it's testable without a cluster."""

from collections import deque
from dataclasses import dataclass, field

from trend import linear_slope, project

# "Something is happening" vs "this is the level we want to prevent ever reaching".
# Both demo-api stress gauges (stress_active_cpu_tasks, hikaricp_connections_pending)
# use the same two thresholds -- see agent.py for which metrics are watched.
WATCH_THRESHOLD = 1.0
PAIN_THRESHOLD = 3.0
DEFAULT_WINDOW_SIZE = 5


@dataclass
class MetricWatch:
    name: str
    query: str
    history: deque = field(default_factory=lambda: deque(maxlen=DEFAULT_WINDOW_SIZE))

    def observe(self, timestamp: float, value: float) -> None:
        self.history.append((timestamp, value))

    def slope(self) -> float:
        return linear_slope(list(self.history))

    def latest(self) -> float:
        return self.history[-1][1] if self.history else 0.0


def decide(watch: MetricWatch, lookahead_seconds: float) -> dict:
    """Returns a decision dict with action "scale" (reason "reactive" if already
    past PAIN_THRESHOLD, "proactive" if only the projected trend breaches it) or
    action "none"."""
    current = watch.latest()
    slope = watch.slope()
    projected = project(current, slope, lookahead_seconds)

    base = {
        "metric": watch.name,
        "current": current,
        "slope": slope,
        "projected": projected,
    }

    if current >= PAIN_THRESHOLD:
        return {**base, "action": "scale", "reason": "reactive"}
    if slope > 0 and projected >= PAIN_THRESHOLD:
        return {**base, "action": "scale", "reason": "proactive"}
    return {**base, "action": "none"}
