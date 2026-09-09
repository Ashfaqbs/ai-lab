# Docker Copilot

## Overview

Docker Copilot is a proof-of-concept chat application for observing and managing
local Docker containers through a conversational agent. The agent can freely
inspect containers (list, logs, stats, inspect) but cannot start, stop, restart,
or remove a container on its own. Any state-changing action must be explicitly
approved by a human before it executes.

The project exists primarily as a learning exercise on human-in-the-loop (HITL)
design for AI agents: how to let a language model operate tools freely for
read-only work while gating every consequential action behind an explicit human
decision, and how that pattern is implemented in production systems.

## Why human-in-the-loop

An agent with direct write access to infrastructure (starting, stopping, or
deleting containers) can act on a misread instruction, a hallucinated
container ID, or a prompt injection with no chance to intervene. Human-in-the-loop
addresses this by splitting every write action into two steps:

1. Propose - the agent's write tool call never executes the action. It creates
   a pending request describing what would happen and returns immediately.
2. Decide - a human reviews the pending request in the chat interface and
   explicitly approves or rejects it. Only approval triggers the real Docker
   SDK call.

This keeps the agent fast and autonomous for anything reversible or read-only,
while keeping a human as the final authority over anything that changes real
state.

## What was explored

Building this project involved researching how production agent systems (for
example LangGraph's interrupt-based workflows and enterprise approval-gate
platforms) implement HITL, and comparing that against this implementation.
Concretely:

- State re-validation at resume time, not at proposal time: an approval
  handler re-checks the real container state (via the Docker SDK) at the
  moment of execution rather than trusting data captured when the action was
  proposed. A container that was removed or changed state during the approval
  window is caught here.
- Enforcing the approval gate outside the language model's control: the
  propose/approve split lives in application code, never inside the agent's
  own reasoning, so the gate cannot be talked around by a misleading or
  injected instruction.
- Replay protection: an action that has already been approved or rejected
  cannot be resolved a second time.
- Expiry: a pending action that sits unresolved past a time-to-live is
  automatically marked expired rather than remaining open indefinitely.
- Validate-before-execute ordering: an action's status is checked before any
  real Docker call is made, not after, so an expired or already-resolved
  action cannot still cause a side effect before the error is surfaced.
- Audit trail: every proposal and every resolution (approved or rejected) is
  appended to an immutable local log, independent of the in-memory action
  store, so a decision is not lost if the process restarts.
- Grounding the agent's answers in live state rather than conversation memory:
  questions like "is it stopped now" are answered by calling a read tool
  against the real container state, not by recalling earlier messages, since
  a container can be proposed for the same action more than once in a
  session with different outcomes.

Not implemented, and deliberately out of scope for a single-user proof of
concept: multiple approvers or reviewer identity, a persistent database for
the action store, policy escalation tiers beyond a single approve/reject
decision, and a distributed approval queue.

## Architecture

```
docker-copilot/
  backend/
    app/
      main.py          FastAPI app: chat, SSE stream, approve/reject routes
      agent.py          LangChain agent setup and system prompt
      docker_tools.py    Read tools and propose_* write tools
      docker_client.py   Docker SDK client
      actions.py         Pending-action state machine (propose/approve/reject/expire)
      audit.py           Append-only audit log for proposals and resolutions
      config.py          Settings (Groq API key, model)
    tests/
  frontend/
    src/
      main.js            Chat UI, container sidebar, approval cards (vanilla JS)
      style.css
```

Backend: FastAPI, the Docker SDK for Python, LangChain with a Groq-hosted
model. The agent has eight tools: four read-only (list_containers,
inspect_container, get_logs, get_stats) and four propose-only
(propose_start, propose_stop, propose_restart, propose_remove). Chat runs
over a REST POST plus a server-sent-events stream; approvals and rejections
are separate REST endpoints.

Frontend: plain HTML, CSS, and JavaScript served by Vite, with no framework.
The chat renders the small subset of markdown the agent is instructed to
produce (bold text and GitHub-flavored tables) and shows an inline
approve/reject card for every pending action.

## Running locally

Backend:

```
cd backend
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Requires `GROQ_API_KEY` in `backend/.env` (see `backend/.env.example`).

Frontend:

```
cd frontend
npm install
npm run dev
```

Open the address Vite prints (default `http://localhost:5173`).

## Testing

```
cd backend
.venv/Scripts/python -m pytest
```

Tests cover the pending-action state machine (create, resolve, expiry,
replay protection) and the Docker tool wrappers (read tools and the
propose_* write tools), with the Docker SDK mocked.
