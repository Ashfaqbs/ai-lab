# proactive-sre-agent — Phase 1: Observable Base System

Implements Phase 1 of [`designs/proactive-sre-agent`](../../designs/proactive-sre-agent/README.md):
a Spring Boot + Postgres service, instrumented with Prometheus/Grafana, deployed to a local
`kind` cluster with a baseline CPU-based HPA, plus on-demand stress endpoints and a Python
script that measures how early a leading indicator climbs ahead of a lagging one.

See [`DECISIONS.md`](DECISIONS.md) for the full log of decisions, rulings, and bugs found
and fixed while building this.

## Run it end to end

```bash
projects/proactive-sre-agent/scripts/setup-kind.sh
projects/proactive-sre-agent/scripts/build-and-load.sh

kubectl apply -f projects/proactive-sre-agent/k8s/00-namespace.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/05-postgres-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/10-postgres.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/20-demo-api.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/30-prometheus.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/50-kube-state-metrics.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-secret.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana-dashboard.yaml
kubectl apply -f projects/proactive-sre-agent/k8s/40-grafana.yaml

kubectl -n ailab-poc port-forward svc/grafana 3000:3000 &
kubectl -n ailab-poc port-forward svc/prometheus 9090:9090 &

projects/proactive-sre-agent/scripts/run-scenario.sh normal-load
projects/proactive-sre-agent/scripts/run-scenario.sh cpu-stress
projects/proactive-sre-agent/scripts/run-scenario.sh db-hold-stress
```

Grafana: http://localhost:3000 (admin/admin, lab-only). Prometheus: http://localhost:9090.

## Measuring lead time

```bash
cd projects/proactive-sre-agent/measure
pip install -r requirements.txt
python measure.py --prom-url http://localhost:9090 --start <unix_ts> --end <unix_ts> \
  --leading-query 'sum(stress_active_cpu_tasks{job="demo-api"})' --leading-threshold 1 \
  --lagging-query 'histogram_quantile(0.99, sum(rate(http_server_requests_seconds_bucket{job="demo-api"}[1m])) by (le))' \
  --lagging-threshold 0.05
```

`measure.py` requires an aggregating query (`sum(...)`, `max(...)`) — it raises if a query
matches more than one series, since Prometheus doesn't guarantee series order and picking
one silently would be an arbitrary number, not a real one. This matters because demo-api
can run multiple replicas (the HPA may have scaled it out).

## Measured results

- `cpu-stress`: leading indicator (`stress_active_cpu_tasks`) crossed its threshold
  **5.0 seconds** before the lagging indicator (p99 latency) crossed its own. Full report:
  [`measure/cpu-stress-report.json`](measure/cpu-stress-report.json). Measured after fixing
  a Prometheus scrape-topology bug (see DECISIONS.md, 2026-10-10) that could otherwise mix
  different pods' values into one series once the HPA scaled out.
- `db-hold-stress`: leading indicator (`hikaricp_connections_pending`) crossed its
  threshold **5.0 seconds** before the lagging indicator crossed its own. Full report:
  [`measure/db-hold-stress-report.json`](measure/db-hold-stress-report.json).
- **Honest caveat:** 5.0s is also this setup's Prometheus `scrape_interval` — the coarsest
  unit the measurement can currently resolve. The true lead time is somewhere between
  just-under-5s and just-under-10s for both scenarios; a shorter scrape interval would
  sharpen this. Not fudging the numbers past what was actually measured.
- HPA (CPU-based) reacted to `cpu-stress` (scaled 1 -> 4 replicas, confirmed via
  `kubectl get hpa`). It does **not** react to `db-hold-stress` — connection-pool
  exhaustion isn't a CPU signal — which is exactly the gap Phase 2's agent needs to close:
  a trend-aware agent reading Hikari pool metrics could catch this where a CPU-only HPA
  structurally cannot.

## Known lab-only shortcuts (see DECISIONS.md for full reasoning)

- Postgres and Grafana credentials are hardcoded placeholders (`demo`/`demo`,
  `admin`/`admin`) in K8s `Secret` objects — fine because this cluster is never reachable
  outside `kubectl port-forward` on localhost, never because the review flag was wrong.
- Testcontainers-based integration test (`OrderIntegrationTest`) couldn't run locally due
  to a Windows/Docker-Desktop npipe detection issue unrelated to the code; the same code
  path is verified for real by the live cluster deployment instead.

## Phase 2: the proactive agent

`projects/proactive-sre-agent/agent/` — polls Prometheus, fits a trend line over the
leading indicators, and scales demo-api up *before* a metric breaches its pain
threshold, not after. **Note on scope:** this is a deterministic trend-detection engine,
not a live LLM-reasoning loop over real Grafana MCP + Kubernetes MCP servers — see
DECISIONS.md (2026-10-09, "Phase 2 scope ruling") for why, and for how to extend it into
one. `grafana_tool.py` and `k8s_tool.py` are written as clean, swappable stand-ins for
exactly those two MCP tool calls.

Run it locally against the live cluster:
```bash
cd projects/proactive-sre-agent/agent
pip install -r requirements.txt
kubectl -n ailab-poc port-forward svc/prometheus 9090:9090 &
python agent.py --prom-url http://localhost:9090 --kubeconfig --duration 120
```

Or deploy it into the cluster (uses its own scoped ServiceAccount, no local kubeconfig):
```bash
docker build -t ailab/proactive-agent:local projects/proactive-sre-agent/agent
kind load docker-image ailab/proactive-agent:local --name ailab-poc
kubectl apply -f projects/proactive-sre-agent/k8s/70-agent.yaml
kubectl -n ailab-poc logs -f deployment/proactive-agent
```

**Real proactive catch, captured as evidence:**
[`agent/sample-audit-proactive-catch.log`](agent/sample-audit-proactive-catch.log) — the
agent scaled demo-api 1 -> 2 -> 3 -> 4, three separate times, while
`stress_active_cpu_tasks` was still at `2.0` (below the `3.0` pain threshold), purely
because the fitted trend projected a breach within the 10-second lookahead window. Two
honest negative findings before reaching this clean result (k6's default ramp is too
fast for 5s-resolution trend detection; running the agent right after an HPA-triggered
scale-out contaminates the comparison) are written up in DECISIONS.md rather than
smoothed over.

20 unit tests (`test_trend.py`, `test_decision.py`, `test_agent.py`) cover the trend math
and the proactive/reactive decision logic without needing a live cluster — run with
`python -I -m pytest` from `projects/proactive-sre-agent/agent/`.

## Status

Phase 1 and Phase 2 both implemented and verified end to end against a real `kind`
cluster, including a genuine proactive-before-breach scaling event (not a mocked or
simulated one). See DECISIONS.md for the full decision log, what got reviewed and fixed,
and what's deliberately deferred.

## Prior art: mature open source doing this already

This is a learning POC, not a novel technique. Before extending it further, see
[`../../designs/proactive-sre-agent/PRIOR_ART.md`](../../designs/proactive-sre-agent/PRIOR_ART.md)
for the open-source projects that already solve pieces of this with more features and
real maintainer backing — notably **KEDA + PredictKube** (predictive autoscaling),
**Keptn** / **Robusta** / **StackStorm** (Prometheus-driven remediation workflows),
**HolmesGPT** / **k8sgpt** (LLM agents over live observability data), and
**grafana/mcp-grafana** / **containers/kubernetes-mcp-server** (the MCP servers this
project's `grafana_tool.py`/`k8s_tool.py` stand in for). PromQL's own `predict_linear()`
is the built-in equivalent of `agent/trend.py`'s hand-rolled linear regression.
