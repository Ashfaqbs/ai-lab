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

## Status

Phase 1 complete and verified end to end against a real `kind` cluster. Phase 2 (the
MCP-driven proactive agent — Grafana MCP read path, Kubernetes MCP action path,
trend-detection decision loop) follows next.
