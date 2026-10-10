"""Proactive SRE agent: polls Prometheus for demo-api's leading indicators, projects
each metric's short-term trend, and scales the demo-api Deployment up BEFORE a tracked
metric reaches its pain threshold -- not after, the way a plain CPU-based HPA would.

Every tick is written to the audit log (and stdout) as one JSON line: the metric
values observed, the slope/projection computed, and whether an action was taken and
why. See decision.py for the proactive-vs-reactive decision rule and DECISIONS.md for
why this agent calls Prometheus/Kubernetes directly rather than through live Grafana
MCP + Kubernetes MCP servers behind an LLM reasoning step."""

import argparse
import json
import sys
import time

from kubernetes import client, config

from decision import MetricWatch, decide
from grafana_tool import read_metric
from k8s_tool import get_replica_count, scale_deployment

WATCHED_METRICS = [
    ("stress_active_cpu_tasks", 'sum(stress_active_cpu_tasks{{job="{job}"}})'),
    ("hikaricp_connections_pending", 'sum(hikaricp_connections_pending{{job="{job}"}})'),
]


def build_watches(job: str) -> list[MetricWatch]:
    return [MetricWatch(name, query_template.format(job=job))
            for name, query_template in WATCHED_METRICS]


def run_tick(
    apps_v1,
    watches: list[MetricWatch],
    args: argparse.Namespace,
    last_action_at: float,
    now: float,
) -> tuple[dict, float]:
    """Runs one poll-decide-act cycle. Returns the audit record and the (possibly
    updated) last_action_at timestamp."""
    decisions = []
    for watch in watches:
        value = read_metric(args.prom_url, watch.query)
        if value is not None:
            watch.observe(now, value)
        decisions.append(decide(watch, args.lookahead))

    triggered = [d for d in decisions if d["action"] == "scale"]
    record = {"timestamp": now, "decisions": decisions}

    if not triggered:
        return record, last_action_at

    if (now - last_action_at) < args.cooldown:
        record["action_taken"] = {"skipped": "cooldown"}
        return record, last_action_at

    current_replicas = get_replica_count(apps_v1, args.namespace, args.deployment)
    if current_replicas >= args.max_replicas:
        record["action_taken"] = {"skipped": "already at max_replicas"}
        return record, last_action_at

    new_replicas = min(current_replicas + 1, args.max_replicas)
    scale_deployment(apps_v1, args.namespace, args.deployment, new_replicas)
    record["action_taken"] = {
        "from_replicas": current_replicas,
        "to_replicas": new_replicas,
        "triggered_by": triggered,
    }
    return record, now


def run(args: argparse.Namespace) -> None:
    if args.kubeconfig:
        config.load_kube_config()
    else:
        config.load_incluster_config()
    apps_v1 = client.AppsV1Api()

    watches = build_watches(args.job)
    last_action_at = 0.0
    deadline = time.time() + args.duration

    with open(args.audit_log, "a", encoding="utf-8") as audit:
        while time.time() < deadline:
            record, last_action_at = run_tick(
                apps_v1, watches, args, last_action_at, time.time()
            )
            line = json.dumps(record)
            print(line)
            audit.write(line + "\n")
            audit.flush()
            time.sleep(args.poll_interval)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prom-url", default="http://localhost:9090")
    parser.add_argument("--namespace", default="ailab-poc")
    parser.add_argument("--deployment", default="demo-api")
    parser.add_argument("--job", default="demo-api", help="Prometheus job label")
    parser.add_argument("--poll-interval", type=float, default=5.0)
    parser.add_argument("--lookahead", type=float, default=10.0)
    parser.add_argument("--cooldown", type=float, default=30.0)
    parser.add_argument("--max-replicas", type=int, default=4)
    parser.add_argument("--duration", type=float, default=120.0)
    parser.add_argument("--audit-log", default="agent-audit.log")
    parser.add_argument(
        "--kubeconfig", action="store_true",
        help="Use the local kubeconfig instead of in-cluster config",
    )
    args = parser.parse_args()
    run(args)


if __name__ == "__main__":
    main()
