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
  - [`inframask`](designs/inframask/README.md) — InfraMask, a reversible browser extension
    that masks infra identifiers (IPs, hostnames, Kafka bootstrap servers) before they reach
    an AI chat UI, and restores them in the assistant's response.
  - [`mcp-grafana-architecture-review`](designs/mcp-grafana-architecture-review/README.md) —
    a file-cited review of how the real [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)
    MCP server is actually built.
  - [`mcp-server-design-lessons`](designs/mcp-server-design-lessons/README.md) — the
    generalized, Grafana-agnostic checklist distilled from that review, for building a
    different MCP server from scratch.
- **`projects/`** — actual working code.
  - [`docker-copilot`](projects/docker-copilot/README.md) — a human-in-the-loop chat agent
    for observing and managing local Docker containers: free read access, every
    state-changing action gated behind explicit human approval.

## Conventions

- Every design doc lives at `designs/<kebab-case-name>/README.md` and follows a consistent
  shape: a problem statement, prior art (real named alternatives, not assumed), goals and
  non-goals, an architecture diagram, a component breakdown, an end-to-end data-flow
  diagram, alternatives considered with reasons for rejecting each, a glossary, an FAQ, and
  open questions for review.
- Commits go straight to `main` (no PR workflow on this personal repo), using conventional
  commit prefixes (`feat:`, `fix:`, `docs:`).
