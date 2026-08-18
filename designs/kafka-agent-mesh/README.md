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

## 6. Interface Contracts and Implementation Prerequisites

This section specifies the details required to implement Section 3 consistently. It
resolves the gaps identified in design review before an implementation plan is written.

### 6.1 KafkaIQ Deployment Prerequisite

KafkaIQ, as it exists today, initializes a single Kafka connection per running process via
`initialize_kafka_connection`. It does not support serving multiple clusters from one
instance. This design therefore requires one KafkaIQ process per registered cluster, each
started with its own bootstrap servers and listening on its own port. This is a deployment
requirement on top of KafkaIQ as-is, not a change to its code. `cluster_registry` (Section
3.3) stores the resulting `kafkaiq_mcp_url` per cluster so specialist agents never need to
know this detail.

### 6.2 Agent-to-Tool Mapping

Each specialist agent's responsibilities map to specific KafkaIQ MCP tools. An agent may
call more than one tool per invocation; all tool results it uses become part of the
finding it writes.

| Agent | KafkaIQ tools called |
|---|---|
| Broker / Cluster Agent | `kafka_health_check`, `get_cluster_details`, `broker_leadership_distribution`, `get_broker_resources`, `get_offline_partitions` |
| Topic Agent | `list_kafka_topics`, `describe_kafka_topic`, `get_kafka_topic_config` |
| Consumer Group / Lag Agent | `get_consumer_lag` |
| Metadata / Topology Agent | reads `cluster_registry` directly; does not call KafkaIQ |
| Performance Agent *(v2)* | not covered by current KafkaIQ tools; requires new KafkaIQ tooling before this agent can be built |

### 6.3 Finding Schema

Every specialist agent writes one Finding object to
`session:{id}:finding:{agent}`. All Findings share a common envelope so the Verifier
Agent (Section 6.4) can process them without per-agent special cases:

```json
{
  "agent": "broker_cluster_agent",
  "cluster_id": "payments-prod",
  "tool_calls": [
    {
      "tool": "get_broker_resources",
      "arguments": { "broker_id": 2 },
      "result": { "cpu_pct": 91, "disk_pct": 44 },
      "called_at": "2026-08-18T10:14:02Z"
    }
  ],
  "facts": [
    {
      "id": "broker_cluster_agent.0",
      "statement": "Broker 2 CPU utilization is 91 percent",
      "source_tool_call": 0
    }
  ],
  "status": "ok"
}
```

`status` is one of `ok`, `partial` (some tool calls failed or timed out), or `error` (the
agent could not produce any facts). `facts` is a flat list of atomic, single-value
statements derived directly from `tool_calls`; an agent must not include a fact that
requires combining or interpreting multiple tool results; combined statements (for
example, an average across brokers) are computed by the Main Agent during synthesis and
must cite every `facts[].id` used to derive them.

### 6.4 Verifier Algorithm

The Verifier Agent does not perform free-text matching against findings. Instead, the
Main Agent is required to produce its draft answer as a list of sentence objects, each
citing the fact IDs it is based on:

```json
{
  "sentences": [
    {
      "text": "Broker 2 is under high CPU load at 91 percent utilization.",
      "cites": ["broker_cluster_agent.0"]
    },
    {
      "text": "This is consistent with the consumer lag increase.",
      "cites": ["broker_cluster_agent.0", "consumer_lag_agent.2"]
    }
  ]
}
```

The Verifier Agent then applies the following deterministic checks, with no LLM
involvement:

1. Every `cites` entry must resolve to a `facts[].id` present in this session's findings.
   A sentence citing an unknown or missing ID is removed from the answer.
2. A sentence with an empty `cites` list is removed unless it is a purely structural
   statement (for example, a section heading), which must be flagged as such by the Main
   Agent at generation time.
3. Numeric values written directly in `text` (for example, "91 percent") are checked
   against the numeric value in every cited fact; a mismatch removes the sentence and logs
   a verification failure for review.
4. If, after steps 1 to 3, the plan's required findings (Section 6.5) are not fully
   represented by at least one surviving sentence, the entire answer is replaced with an
   explicit "insufficient data" response naming which required finding is missing.

This makes grounding a property of the answer's data structure, not a property enforced
by prompt instruction alone.

### 6.5 Insufficient-Data Rule

Before specialists run, the Main Agent's plan (`session:{id}:plan`) must list the findings
it considers required to answer the question, not only which agents to invoke. An answer
may be returned only if every required finding has `status: ok` or `status: partial` with
at least one usable fact. If a required finding has `status: error` or is absent, the
Main Agent must return "insufficient data," naming the missing finding, instead of
synthesizing an answer from the findings that did succeed.

### 6.6 Cluster Registry Storage

Storing `cluster_registry` only in Redis is acceptable for the v1 local demonstration but
is not a production-appropriate source of truth: Redis is not the system of record for
data that must survive independently of the cache layer. For production use, the registry
should be backed by a durable store (for example, PostgreSQL) with Redis used as a
read-through cache in front of it, so `cluster_registry:{cluster_id}` reads stay fast
without Redis being the only copy of the data.

## 7. Open Questions and Next Steps

- Orchestration framework: LangGraph (Python).
- LLM: Grok API, used strictly for planning and synthesis, never for fact generation, per
  Section 3.2.
- Proposed v1 scope: Broker, Topic, Consumer/Lag, Metadata, and Verifier agents, plus
  Redis, using the interfaces defined in Section 6. Performance Agent and Runbook/
  Knowledge Agent are designated v2 extension points and require new KafkaIQ tooling
  before they can be built (Section 6.2).
- Not yet decided: the exact LangGraph graph structure, the docker-compose and KRaft
  configuration for the local two-cluster simulation (Section 3.4 describes the intent;
  no configuration has been written yet), and the implementation plan itself, to be
  produced separately following review of this design.
