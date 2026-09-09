import time
import uuid
from dataclasses import dataclass
from functools import lru_cache

DEFAULT_TTL_SECONDS = 300.0


@dataclass
class PendingAction:
    action_id: str
    action_type: str
    container_id: str
    description: str
    created_at: float
    expires_at: float
    status: str = "pending"
    result: dict | None = None


class ActionStore:
    def __init__(self, ttl_seconds: float = DEFAULT_TTL_SECONDS) -> None:
        self._actions: dict[str, PendingAction] = {}
        self._ttl_seconds = ttl_seconds

    def create(self, action_type: str, container_id: str, description: str) -> PendingAction:
        now = time.time()
        action = PendingAction(
            action_id=str(uuid.uuid4()),
            action_type=action_type,
            container_id=container_id,
            description=description,
            created_at=now,
            expires_at=now + self._ttl_seconds,
        )
        self._actions[action.action_id] = action
        return action

    def _expire_if_stale(self, action: PendingAction) -> PendingAction:
        if action.status == "pending" and time.time() >= action.expires_at:
            action.status = "expired"
        return action

    def get(self, action_id: str) -> PendingAction | None:
        action = self._actions.get(action_id)
        if action is None:
            return None
        return self._expire_if_stale(action)

    def get_pending(self) -> PendingAction | None:
        for action in self._actions.values():
            self._expire_if_stale(action)
            if action.status == "pending":
                return action
        return None

    def resolve(self, action_id: str, status: str, result: dict | None = None) -> PendingAction:
        action = self._actions.get(action_id)
        if action is None:
            raise ValueError(f"Action '{action_id}' not found.")
        self._expire_if_stale(action)
        if action.status == "expired":
            raise ValueError(f"Action '{action_id}' has expired and can no longer be resolved.")
        if action.status != "pending":
            raise ValueError(f"Action '{action_id}' already resolved.")
        action.status = status
        action.result = result
        return action


@lru_cache
def get_action_store() -> ActionStore:
    return ActionStore()
