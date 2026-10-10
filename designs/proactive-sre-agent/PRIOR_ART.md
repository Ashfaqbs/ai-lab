# Prior art: open-source alternatives

This project is a hand-built proof of concept. Before treating any of its mechanisms as
novel, or extending it further, it's worth knowing what mature, widely-adopted open source
already does the same job — usually with more features and a real maintainer community
behind it. This doc records that landscape, found by deliberate research after Phase 1 and
Phase 2 were both built and verified (2026-10-10).

## 1. Predictive/proactive Kubernetes autoscaling (what our Phase 2 agent does)

- **[KEDA](https://github.com/kedacore/keda)** — CNCF *graduated* (highest maturity tier),
  8k+ stars, very active. Event-driven scaling via 60+ scalers. Not predictive on its own,
  but is the standard substrate predictive add-ons plug into.
- **[PredictKube](https://keda.sh/blog/2022-02-09-predictkube-scaler/)** (Dysnix) — an
  official KEDA external scaler that uses an ML model to forecast metric trends up to 6
  hours ahead and scale before the spike. This is the productized version of what our
  `agent/trend.py` + `agent/decision.py` do by hand with linear regression.
- **[Kedastral](https://pkg.go.dev/github.com/HatiCode/kedastral)** — smaller, newer OSS
  project, conceptually closest match to our design (forecast -> replica count -> KEDA),
  but far less adopted than PredictKube.
- A KubeCon NA 2025 lightning talk ("Predictive autoscaling in Kubernetes with KEDA and
  Prophet") shows Prophet+KEDA feed-forward patterns as an emerging, not-yet-standardized
  pattern — this confirms trend-based proactive scaling is a real, recognized niche, not
  something CNCF has already fully solved as a first-class feature.

## 2. AIOps / self-healing platforms (Prometheus -> Kubernetes remediation)

- **[Keptn](https://github.com/keptn)** — CNCF *Incubating*. Event-based control plane with
  built-in "remediation sequences" triggered by Prometheus/Dynatrace problem events (scale,
  rollback, etc.) — a full workflow engine, not just a scale decision.
- **[Robusta](https://github.com/robusta-dev)** — ~3k stars, actively released. Prometheus
  alert enrichment plus rule-based auto-remediation playbooks (restart, scale, cordon) with
  alert correlation/noise-reduction our agent doesn't have.
- **[StackStorm](https://github.com/StackStorm/st2)** — ~6.2k stars, mature (since 2014).
  General event-driven IT automation, 160+ integration packs, 6000+ actions. Broader than
  Kubernetes but commonly used as the "brain" behind Prometheus alerts.

## 3. LLM agent + MCP for Kubernetes observability/ops (the scope we deliberately cut)

This is the closest prior art to what the user originally asked for — a live LLM reasoning
loop over a Grafana MCP server and a Kubernetes MCP server — which Phase 2 of this project
explicitly did **not** build (see `projects/proactive-sre-agent/DECISIONS.md`, "Phase 2
scope ruling").

- **[HolmesGPT](https://github.com/robusta-dev/holmesgpt)** (Robusta) — CNCF *Sandbox*
  (accepted Oct 2025), ~2.8k stars, very active. Agentic LLM loop over live observability
  data (Kubernetes, Grafana, Helm, AWS RDS, 40+ integrations) for root-cause analysis, with
  an "operator mode" for continuous in-cluster health checks. This is the closest existing
  production analog to the agent we deliberately chose not to build — it already does
  LLM-driven RCA and is gaining proactive capability, though its forecast-and-pre-scale
  story is thinner than KEDA+PredictKube.
- **[k8sgpt](https://github.com/k8sgpt-ai/k8sgpt)** — CNCF *Sandbox* (accepted Dec 2023),
  6k+ stars, 90+ contributors. LLM-powered analyzers that explain what's wrong with a
  Pod/Deployment/StatefulSet — diagnostic, not forecast-and-pre-scale.
- **[grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)** — official Grafana
  Labs project, ~3k stars, active. The de facto standard MCP server for exposing
  Grafana/Prometheus/Loki queries to an LLM agent. Our `agent/grafana_tool.py` is a
  stand-in for exactly this.
- **[containers/kubernetes-mcp-server](https://github.com/containers/kubernetes-mcp-server)**
  — ~400 stars, actively released, Red-Hat-adjacent (`containers` org). Go-native MCP
  server for full Kubernetes/OpenShift CRUD, pod exec/logs, Helm. Our
  `agent/k8s_tool.py` is a stand-in for exactly this.

## 4. Forecasting/anomaly-detection prior art for the linear regression we hand-rolled

- **PromQL's own `predict_linear()`** — does OLS linear regression over a range vector and
  projects it forward, natively, with no code to write. Direct prior art for
  `agent/trend.py::linear_slope`/`project` — anything beyond this is adding sophistication
  on top of a built-in primitive we reimplemented from scratch.
- **Grafana's anomaly-detection transform** (Grafana 10.x+) — built-in Seasonal-ESD
  anomaly bands, seasonality-aware, no external sidecar.
- **Prophet/Kats-as-sidecar** — a common community pattern (per the KubeCon 2025 talk
  above) of running Facebook Prophet or Kats beside Prometheus for seasonal forecasting,
  more statistically sophisticated (seasonality, holidays, confidence intervals) than our
  plain OLS slope.
- **[PromQL Anomaly Detection framework](https://github.com/grafana/promql-anomaly-detection)**
  — recording + alerting rules generating adaptive bands natively in PromQL/Grafana,
  closer in spirit to our "simple" approach but more robust (multi-band, long/short-term).

## What this means for this project

This POC's value was proving the mechanism end to end against a real cluster with a real
captured proactive catch — not inventing a new technique. None of the above existed as a
constraint when the design doc was written; they're listed here so a reader (or a future
me) doesn't mistake `agent/trend.py` for novel engineering, and knows where to look if this
project moves from "proof it works" to "production dependency":

- Swap the hand-rolled linear regression for **KEDA + PredictKube**, or a Prophet/Kats
  sidecar, instead of maintaining `trend.py` ourselves.
- Benchmark `agent/agent.py`'s decision logic against **HolmesGPT**'s operator mode before
  building a custom LLM+MCP loop from scratch.
- If an MCP layer is added, prefer **grafana/mcp-grafana** and
  **containers/kubernetes-mcp-server** over custom servers — the ecosystem has already
  converged on these two.

Open question for the project owner: given this landscape, is the next step (a) extend this
POC's own agent toward a real MCP+LLM loop as originally envisioned, (b) stop extending it
and instead adopt KEDA/PredictKube + HolmesGPT directly, or (c) leave this as a completed
learning exercise and prior-art reference. Not decided here — this doc only records the
landscape, not a decision.
