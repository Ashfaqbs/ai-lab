import docker.errors

from app.actions import get_action_store
from app.audit import log_event
from app.docker_client import get_docker_client


def list_containers() -> list[dict]:
    client = get_docker_client()
    containers = client.containers.list(all=True)
    return [
        {
            "id": c.id,
            "name": c.name,
            "image": c.image.tags[0] if c.image.tags else "<none>",
            "status": c.status,
        }
        for c in containers
    ]


def inspect_container(container_id: str) -> dict:
    client = get_docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        return {"error": f"Container '{container_id}' not found."}

    attrs = container.attrs
    return {
        "id": attrs["Id"],
        "name": attrs["Name"],
        "status": attrs["State"]["Status"],
        "started_at": attrs["State"]["StartedAt"],
        "image": attrs["Config"]["Image"],
        "ports": attrs["NetworkSettings"]["Ports"],
    }


MAX_LOG_CHARS = 3000


def get_logs(container_id: str, tail: int = 30) -> str:
    client = get_docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        return f"Container '{container_id}' not found."

    text = container.logs(tail=tail).decode("utf-8", errors="replace")
    if len(text) > MAX_LOG_CHARS:
        text = text[-MAX_LOG_CHARS:]
        text = f"[...truncated, showing last {MAX_LOG_CHARS} chars...]\n{text}"
    return text


def get_stats(container_id: str) -> dict:
    client = get_docker_client()
    try:
        container = client.containers.get(container_id)
    except docker.errors.NotFound:
        return {"error": f"Container '{container_id}' not found."}

    stats = container.stats(stream=False)
    cpu_delta = (
        stats["cpu_stats"]["cpu_usage"]["total_usage"]
        - stats["precpu_stats"]["cpu_usage"]["total_usage"]
    )
    system_delta = (
        stats["cpu_stats"]["system_cpu_usage"]
        - stats["precpu_stats"]["system_cpu_usage"]
    )
    online_cpus = stats["cpu_stats"].get("online_cpus", 1)
    cpu_percent = 0.0
    if system_delta > 0 and cpu_delta > 0:
        cpu_percent = round((cpu_delta / system_delta) * online_cpus * 100, 2)

    memory_usage_mb = round(stats["memory_stats"]["usage"] / (1024 * 1024), 2)
    memory_limit_mb = round(stats["memory_stats"]["limit"] / (1024 * 1024), 2)

    return {
        "cpu_percent": cpu_percent,
        "memory_usage_mb": memory_usage_mb,
        "memory_limit_mb": memory_limit_mb,
    }


_ACTION_VERBS = {
    "start": "Start",
    "stop": "Stop",
    "restart": "Restart",
    "remove": "Remove",
}


def _propose(action_type: str, container_id: str) -> str:
    store = get_action_store()

    existing = store.get_pending()
    if existing is not None:
        return (
            f'There is already an open request awaiting the human\'s decision: '
            f'"{existing.description}" (action_id={existing.action_id}). '
            f"It must be approved or rejected before a new action can be proposed."
        )

    client = get_docker_client()
    try:
        client.containers.get(container_id)
    except docker.errors.NotFound:
        return f"Container '{container_id}' not found."

    description = f"{_ACTION_VERBS[action_type]} container {container_id}"
    action = store.create(action_type, container_id, description)
    log_event(
        "proposed",
        action_id=action.action_id,
        action_type=action.action_type,
        container_id=action.container_id,
    )
    return (
        f"{description} is now awaiting the human's decision: approve or reject "
        f"(action_id={action.action_id})."
    )


def propose_start(container_id: str) -> str:
    return _propose("start", container_id)


def propose_stop(container_id: str) -> str:
    return _propose("stop", container_id)


def propose_restart(container_id: str) -> str:
    return _propose("restart", container_id)


def propose_remove(container_id: str) -> str:
    return _propose("remove", container_id)
