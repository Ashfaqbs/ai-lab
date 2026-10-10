# ai-lab

A personal lab for AI and agent system design: architecture proposals, reviews of real
production systems, and small working projects exploring how to build agentic and
AI-integrated software well — human-in-the-loop safety, grounded/anti-hallucination tool
design, and Model Context Protocol (MCP) servers among them.

## Layout

- **`designs/`** — documentation only, no code: design proposals for systems not yet built,
  and architecture reviews of real existing systems (with the lessons those reviews produce
  written up separately, so a review of one specific project and the generalized takeaways
  from it don't get tangled together).
  - [`kafka-agent-mesh`](designs/kafka-agent-mesh/README.md) — KafkaMind, a grounded
    multi-agent diagnostic system for distributed Kafka fleets.
  - [`agentic-support-platform`](designs/agentic-support-platform/README.md) — AgentDesk, a
    self-service agentic RAG support platform: teams register an application and its
    documentation and get a Slack-integrated, grounded assistant with optional live-context
    tool calls into their own MCP server.
  - [`inframask`](designs/inframask/README.md) — InfraMask, a reversible browser extension
    that masks infra identifiers (IPs, hostnames, Kafka bootstrap servers) before they reach
    an AI chat UI, and restores them in the assistant's response.
  - [`mcp-grafana-architecture-review`](designs/mcp-grafana-architecture-review/README.md) —
    a file-cited review of how the real [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)
    MCP server is actually built.
  - [`mcp-server-design-lessons`](designs/mcp-server-design-lessons/README.md) — the
    generalized, Grafana-agnostic checklist distilled from that review, for building a
    different MCP server from scratch.
  - [`shipyard-platform`](designs/shipyard-platform/README.md) — Shipyard, a self-hosted
    prompt-to-deployed-app platform: a user prompt drives an agent that writes and runs a
    full-stack codebase inside an isolated per-session Kubernetes sandbox, with live preview
    and an explicit, audited deploy-to-Kubernetes tool call.
  - [`proactive-sre-agent`](designs/proactive-sre-agent/README.md) — a two-phase project:
    an observable backend + Postgres + Prometheus/Grafana + a reactive HPA baseline in
    Kubernetes, then an agent that reads metric trends and scales Kubernetes to fix
    problems before they fully breach, ahead of a threshold-based tool like HPA. Both
    phases implemented; Phase 2 shipped as a deterministic trend engine rather than the
    live-MCP-plus-LLM loop originally envisioned here (see the project's DECISIONS.md).
- **`projects/`** — actual working code.
  - [`docker-copilot`](projects/docker-copilot/README.md) — a human-in-the-loop chat agent
    for observing and managing local Docker containers: free read access, every
    state-changing action gated behind explicit human approval.
  - [`proactive-sre-agent`](projects/proactive-sre-agent/README.md) — the
    `proactive-sre-agent` design, fully implemented: an observable Spring Boot + Postgres
    service with on-demand CPU/memory/DB-pool stress endpoints, Prometheus/Grafana, a
    baseline CPU-based HPA, a Python script that measures how far ahead of failure the
    leading indicators actually climb, and a trend-detection agent that scales the
    service up before a tracked metric breaches, with a captured real example of it
    doing exactly that.
  - [`inframask-extension`](projects/inframask-extension/README.md) — a Chrome extension
    implementing the `inframask` design: masks passwords, API keys, bootstrap servers, and
    other infra identifiers before they reach an AI chat UI, and restores them in the
    response view only.

## Conventions

- Every design doc lives at `designs/<kebab-case-name>/README.md` and follows a consistent
  shape: a problem statement, prior art (real named alternatives, not assumed), goals and
  non-goals, an architecture diagram, a component breakdown, an end-to-end data-flow
  diagram, alternatives considered with reasons for rejecting each, a glossary, an FAQ, and
  open questions for review.
- Commits go straight to `main` (no PR workflow on this personal repo), using conventional
  commit prefixes (`feat:`, `fix:`, `docs:`).
