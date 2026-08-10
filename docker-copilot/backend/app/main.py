import asyncio
import json
import uuid

import docker.errors
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.actions import get_action_store
from app.agent import build_agent_executor
from app.audit import log_event
from app.docker_client import get_docker_client
from app.docker_tools import list_containers
from app.markdown_fixup import normalize_tables

app = FastAPI(title="Docker Copilot")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_HISTORY_MESSAGES = 10

_chat_history: list[tuple[str, str]] = []
_subscribers: set[asyncio.Queue] = set()
_agent_executor = None


async def _broadcast(event: str, data: dict) -> None:
    for queue in list(_subscribers):
        await queue.put({"event": event, "data": data})


def _get_agent_executor():
    global _agent_executor
    if _agent_executor is None:
        _agent_executor = build_agent_executor()
    return _agent_executor


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    run_id: str


ACTION_EXECUTORS = {
    "start": lambda c: c.start(),
    "stop": lambda c: c.stop(),
    "restart": lambda c: c.restart(),
    "remove": lambda c: c.remove(),
}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    run_id = str(uuid.uuid4())
    asyncio.create_task(_run_agent(run_id, request.message))
    return ChatResponse(run_id=run_id)


async def _run_agent(run_id: str, message: str) -> None:
    executor = _get_agent_executor()
    before_actions = set(get_action_store()._actions.keys())

    try:
        result = await asyncio.to_thread(
            executor.invoke, {"input": message, "chat_history": _chat_history}
        )
        output = normalize_tables(result["output"])
    except Exception as exc:
        await _broadcast(
            "token",
            {"run_id": run_id, "text": f"Something went wrong talking to the model: {exc}"},
        )
        await _broadcast("done", {"run_id": run_id})
        return

    _chat_history.append(("human", message))
    _chat_history.append(("ai", output))
    del _chat_history[:-MAX_HISTORY_MESSAGES]

    after_actions = get_action_store()._actions
    new_action_ids = set(after_actions.keys()) - before_actions
    for action_id in new_action_ids:
        action = after_actions[action_id]
        await _broadcast(
            "pending_action",
            {
                "run_id": run_id,
                "action_id": action.action_id,
                "action_type": action.action_type,
                "container_id": action.container_id,
                "description": action.description,
            },
        )

    await _broadcast("token", {"run_id": run_id, "text": output})
    await _broadcast("done", {"run_id": run_id})


@app.get("/chat/stream")
async def chat_stream():
    queue: asyncio.Queue = asyncio.Queue()
    _subscribers.add(queue)

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"
        finally:
            _subscribers.discard(queue)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/actions/{action_id}/approve")
async def approve_action(action_id: str) -> dict:
    store = get_action_store()
    action = store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"Action is {action.status}, not pending.")

    client = get_docker_client()
    try:
        container = client.containers.get(action.container_id)
        ACTION_EXECUTORS[action.action_type](container)
        result = {"success": True}
    except docker.errors.NotFound:
        result = {"success": False, "error": "Container not found"}
    except docker.errors.APIError as exc:
        result = {"success": False, "error": str(exc)}

    resolved = store.resolve(action_id, "approved", result)
    log_event(
        "resolved",
        action_id=resolved.action_id,
        status=resolved.status,
        result=resolved.result,
        container_id=resolved.container_id,
    )
    _note_action_outcome(resolved)
    await _broadcast(
        "action_resolved",
        {"action_id": resolved.action_id, "status": resolved.status, "result": resolved.result},
    )
    return {"status": resolved.status, "result": resolved.result}


@app.post("/actions/{action_id}/reject")
async def reject_action(action_id: str) -> dict:
    store = get_action_store()
    action = store.get(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    if action.status != "pending":
        raise HTTPException(status_code=409, detail=f"Action is {action.status}, not pending.")

    resolved = store.resolve(action_id, "rejected")
    log_event(
        "resolved",
        action_id=resolved.action_id,
        status=resolved.status,
        result=None,
        container_id=resolved.container_id,
    )
    _note_action_outcome(resolved)
    await _broadcast(
        "action_resolved",
        {"action_id": resolved.action_id, "status": resolved.status, "result": None},
    )
    return {"status": resolved.status}


def _note_action_outcome(action) -> None:
    if action.status == "approved":
        outcome = "succeeded" if action.result and action.result.get("success") else (
            f"failed ({action.result.get('error')})" if action.result else "failed"
        )
        note = (
            f'[system] Decision on "{action.description}" (action_id={action.action_id}): '
            f"APPROVED. The {action.action_type} action {outcome}."
        )
    else:
        note = (
            f'[system] Decision on "{action.description}" (action_id={action.action_id}): '
            f"REJECTED. No change was made to container {action.container_id}."
        )
    _chat_history.append(("human", note))
    del _chat_history[:-MAX_HISTORY_MESSAGES]


@app.get("/containers")
async def containers() -> list[dict]:
    return list_containers()


@app.get("/actions/pending")
async def pending_action() -> dict | None:
    action = get_action_store().get_pending()
    if action is None:
        return None
    return {
        "action_id": action.action_id,
        "action_type": action.action_type,
        "container_id": action.container_id,
        "description": action.description,
    }
