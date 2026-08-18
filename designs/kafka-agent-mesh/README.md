# KafkaMind: A Grounded Multi-Agent Diagnostic System for Distributed Kafka

**Status:** Design proposal. Not yet implemented.
**Builds on:** [KafkaIQ](https://github.com/Ashfaqbs/KafkaIQ) (single-cluster MCP tool server)

## 1. Problem Statement

[KafkaIQ](https://github.com/Ashfaqbs/KafkaIQ) exposes Kafka operations (topics, brokers,
consumer lag, cluster health) as MCP tools that an LLM client can call. It is a single
stateless tool provider and does not address the following requirements:

- **Multiple clusters.** Production Kafka deployments are rarely a single cluster. A
  typical organization runs `payments-prod`, `payments-staging`, `analytics-prod`, and
  similar, often across regions. No registry exists to describe what clusters exist or how
  to reach each one.
- **Multi-step diagnosis.** A real incident question, such as "why is consumer lag
  spiking," cannot be answered by a single tool call. It requires checking brokers, topics,
  and consumer groups together and reasoning across the combined results.
- **Anti-hallucination guarantees.** Nothing prevents an LLM operating on top of KafkaIQ
  from inventing a broker count or a root cause that sounds plausible without being backed
  by an actual tool call. For a system that Kafka maintainers are expected to trust during
  an incident, this is disqualifying.
- **Shared context across a diagnosis.** When multiple tool calls are required, there is no
  shared memory tying the results together into one coherent, checkable answer.

**Objective:** Design a system in which a developer or Kafka maintainer can ask a
plain-language question about a production Kafka fleet, spanning multiple clusters and
multiple brokers per cluster, and receive an answer that is entirely traceable to real
data, with no invented facts and no silent guessing, and that scales from a two-cluster
local demonstration to a real production fleet without architectural change.

## 2. Prior Art

The following was reviewed before designing this system, to confirm the gap is real and to
reuse proven patterns rather than reinvent them.

- **[k8sgpt](https://github.com/k8sgpt-ai/k8sgpt)** — The closest architectural
  inspiration, though built for Kubernetes rather than Kafka. Its core mechanism —
  deterministic "analyzer" plugins collect real cluster data into structured `Failure`
  objects first, and the LLM only explains pre-verified facts second, never querying the
  cluster directly — is the anti-hallucination pattern this design reuses.
- **[lensesio/agentic-engineering-for-apache-kafka](https://github.com/lensesio/agentic-engineering-for-apache-kafka)**
  — The closest Kafka-specific prior art: eleven Claude "skills" (topic audit, lag,
  performance, security, and others) backed by the Lenses MCP server. It is not a
  multi-agent orchestrator: there is no planner, no specialist agent split, and no shared
  session memory.
- **kafka-mcp-server variants** (`tuannvm/kafka-mcp-server`, `pavanjava/kafka_mcp_server`,
  `kanapuli/mcp-kafka`, `brandon-powers/mcp-kafka`) — All single MCP tool servers, the same
  category as KafkaIQ itself. None include an agent or orchestration layer.
- **[martinimarcello00/SRE-agent](https://github.com/martinimarcello00/SRE-agent)** — The
  closest generic analog: a LangGraph and MCP-based multi-agent system for Kubernetes
  incident detection and diagnosis. It confirms the orchestrator-plus-specialist pattern is
  sound, though it has not been applied to Kafka.
- Academic multi-agent root-cause-analysis literature (Cloud-OpsBench and related work)
  converges on four recurring patterns: a structured topology graph maintained as ground
  truth, specialist agents with bounded context that emit compact evidence rather than raw
  data dumps, an evidence-consolidation step, and confidence gating that declines to
  conclude when evidence is incomplete. All four are applied in Section 3.

**Conclusion:** No existing system combines an orchestrator, grounded specialist agents,
and a verification step for Kafka. This is a genuine gap rather than a restatement of an
existing tool.

## 3. Proposed Design

A **Main Agent** plans which specialist agents to consult for a given question. Each
**specialist agent** calls KafkaIQ MCP tools exclusively and writes back raw, structured
findings; it does not consult the LLM and does not state an opinion. All findings for a
given question are written to **shared session memory** (Redis). A **Verifier Agent**
checks the Main Agent's draft answer against that memory and removes or blocks any claim
not backed by a finding. Only after verification does the answer return to the user, with
each fact traceable to the tool call that produced it.

### 3.1 Agents

| Agent | Role | Notes |
|---|---|---|
| **Main Agent** | Plans which specialists to invoke and in what order (parallel where independent); synthesizes the final answer after verification | LLM is used only for planning and writing, never for stating facts |
| **Metadata / Topology Agent** | Resolves a cluster name or description to a registered KafkaIQ endpoint before any other agent runs | Prevents a mistyped or ambiguous cluster reference from silently routing to the wrong brokers |
| **Broker / Cluster Agent** | Broker resource utilization, in-sync replica state, offline partitions | |
| **Topic Agent** | Topic configuration, partition count, replication factor | |
| **Consumer Group / Lag Agent** | Consumer offsets, lag, rebalance history | Addresses the most common real-world incident category |
| **Performance Agent** *(optional in v1)* | Throughput, latency, quota throttling | Distinct failure domain from broker resource health |
| **Verifier Agent** | Checks the draft answer against session findings; blocks unsupported or contradicting claims | The mechanism that makes grounding a guarantee rather than a prompt instruction |
| **Runbook / Knowledge Agent** *(v2, not built)* | Long-term memory of past incidents (question, findings, diagnosis, outcome) for faster pattern-matched answers | Integrates through the same registry pattern as the other agents |

### 3.2 Anti-Hallucination Mechanism

Adapted from k8sgpt's "detect first, explain second" separation:

1. Specialist agents are detectors, not interpreters. They call KafkaIQ tools and write raw
   JSON findings to Redis. No LLM is involved at this stage.
2. The Main Agent's LLM step receives only the collected findings, never live cluster
   access, and therefore cannot originate a fact that was not supplied to it.
3. The Verifier Agent checks the draft answer mechanically against
   `session:{id}:finding:*`. Any sentence without a matching finding is removed; if too
   much of the answer is unsupported, the response is downgraded to "insufficient data"
   rather than filling the gap with a plausible guess.
4. Every claim in the final answer is tagged with the agent and tool call that produced it,
   forming a citation trail a Kafka maintainer can verify independently.

### 3.3 Shared Memory (Redis)

```
session:{id}:plan             -> Main Agent's step plan (JSON)
session:{id}:finding:{agent}  -> raw structured tool output per agent (JSON, TTL'd)
session:{id}:answer           -> final synthesized answer and citation map
cluster_registry:{cluster_id} -> bootstrap_servers, kafkaiq_mcp_url, env, region, tags
                                  (long-lived, not session-scoped)
```

`cluster_registry` is the mechanism for production scaling. Every specialist agent
addresses only "a KafkaIQ endpoint," resolved through the registry, never a hardcoded
broker list. Two clusters in a local environment and twenty clusters in production run
the identical agent graph; scaling requires adding registry entries, not modifying agents.

### 3.4 Local Simulation

Docker Compose provisions two independent Kafka clusters, three brokers each, running in
KRaft mode (consistent with the current industry direction away from ZooKeeper), each with
its own KafkaIQ instance registered in `cluster_registry`. This mirrors production
topology rather than a simplified stand-in, so the code path validated locally applies to
a production fleet unchanged.

## 4. Worked Example

Question: "Orders are backing up. Is `payments-prod` experiencing consumer lag issues?"

1. The user submits the question in plain language; no Kafka-specific terminology is
   required.
2. The Main Agent reads the question and produces a plan: it selects the Consumer Group /
   Lag Agent, which addresses the question directly, and the Broker / Cluster Agent, since
   a broker issue can also cause lag. The Topic and Performance agents are not invoked, as
   they contribute nothing to this question.
3. The Metadata Agent resolves `payments-prod` to a registered KafkaIQ endpoint before any
   other agent runs.
4. The Broker Agent and Lag Agent execute in parallel, each retrieving current data from
   `payments-prod`'s KafkaIQ instance.
5. Each agent writes its raw findings to the shared Redis session store.
6. The Verifier Agent checks the Main Agent's draft answer against those findings; any
   claim not backed by a finding is removed.
7. The Main Agent produces the final answer: a summary in which every fact traces to a
   specific reading, or an explicit statement that data is insufficient if, for example, a
   broker did not respond.
8. The answer is returned to the user, verifiable against real data end to end.

## 5. Architecture Overview

```
User question
     |
     v
Main Agent (plans only) --resolve cluster--> Metadata / Topology Agent --> cluster_registry
     |
     v  step plan
+---------------------------------------------------------------------+
| Broker/Cluster Agent   Topic Agent   Consumer/Lag Agent   Performance |  (detection only, no LLM)
+---------------+----------------+---------------+---------------------+
                v                v               v
                  Redis: session findings + cluster_registry
                                 |
                                 v
                          Verifier Agent
                    (every claim requires a finding)
                                 |
                                 v
                   Main Agent -- final answer synthesis
                                 |
                                 v
                     Cited answer returned to the user
```

Each specialist agent calls only its assigned cluster's KafkaIQ MCP server; none access
Kafka directly.

## 6. Open Questions and Next Steps

- Orchestration framework: LangGraph (Python).
- LLM: Grok API, used strictly for planning and synthesis, never for fact generation, per
  Section 3.2.
- Proposed v1 scope: Broker, Topic, Consumer/Lag, Metadata, and Verifier agents, plus
  Redis. Performance Agent and Runbook/Knowledge Agent are designated v2 extension points.
- Not yet decided: the exact LangGraph graph structure, KafkaIQ MCP endpoint-per-cluster
  deployment details, and the implementation plan, to be produced separately following
  review of this design.
