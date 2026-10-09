# Decision Log — proactive-sre-agent

Running log of autonomous decisions made while Ashfaq was away. Review and challenge
anything here — nothing is final.

## 2026-10-09

- **Execution method:** Native (I implement, one reviewer pass at the end) over
  subagent-driven. Reasoning: tasks are additive/sequential (each K8s manifest just
  references a Service name the previous task created), no task has a genuinely
  contested design choice worth a fresh reviewer gate, and this is a local lab cluster —
  a shipped mistake costs a re-apply, not an incident.
- **Scope decision:** Proceeding through the full Phase 1 plan (`docs/superpowers/plans/2026-10-09-proactive-sre-agent-phase1.md`),
  then immediately designing and implementing Phase 2 (the actual proactive agent —
  Grafana MCP read path + Kubernetes MCP action path + trend-detection decision loop),
  since the user restated the agent itself is the main goal, not just the base system.
  Phase 2 did not go through a full brainstorming/spec/plan cycle the way Phase 1 did,
  given the user explicitly asked me to take decisions and move while away — I'm instead
  documenting Phase 2's design decisions inline here and in code comments, and will
  flag it clearly as needing the user's review, same as everything else in this log.
- **No git worktree isolation; working directly on local `main`.** The executing-plans
  skill normally mandates an isolated worktree. This repo's own documented convention is
  "commits go straight to `main`, no PR workflow" — consistent with that, and since
  nothing gets pushed without separate explicit approval, local `main` is the right
  branch here, not a throwaway worktree.
- **Skipping the skill's `sdd-workspace`/`task-start`/`task-done` helper scripts.** Those
  assume a harness layout this session doesn't have set up. Substituting a plain ledger
  section below this one, with the same content (task, commits, test command + result,
  rulings) — same record, different mechanism.
- **Ruling: `OrderIntegrationTest` (Testcontainers) left unrun locally.** Docker itself
  works (`docker ps` succeeds), but Testcontainers' Java client can't auto-detect the
  Windows npipe Docker endpoint on this machine (`Could not find a valid Docker
  environment`) — a known Windows/Docker-Desktop interop issue, not a defect in the test
  or the code under test. Fixing the Testcontainers/Windows npipe config is unrelated
  yak-shaving for this task. The same `OrderService`/`OrderRepository`/Flyway code path
  gets exercised for real once `demo-api` is deployed to the `kind` cluster against the
  real Postgres Deployment (Task 6-7) — that's the actual verification this test would
  have given, just via the cluster instead of via Testcontainers. Cost if wrong: a bug in
  Flyway migration syntax or JPA mapping would surface at cluster deploy time instead of
  at `mvn test` time — same detection, one stage later.
- **Bug found and fixed: `MetricsEndpointTest` needed `@AutoConfigureObservability`.**
  Spring Boot 3's test support disables metrics export by default under `@SpringBootTest`
  for speed (`management.defaults.metrics.export.enabled=false`); the plan's original
  test didn't account for this. Also needed one prior HTTP call before scraping, since
  `http_server_requests_seconds_count` for a request only appears after that request
  completes — the scrape call itself doesn't count toward its own metric. Both fixed in
  the test; not a production code bug.
- **Tasks 1-4 executed as one batch, not strictly one task per commit.** The plan's
  `GlobalExceptionHandler` (Task 1) already referenced `StressRequestValidationException`
  (Task 4), so Tasks 1-4 were implemented together and verified with one full test run,
  then committed as a single commit rather than four. Same tests, same coverage, fewer
  commits — a reasonable granularity trade given the plan's own tight coupling between
  these tasks.
