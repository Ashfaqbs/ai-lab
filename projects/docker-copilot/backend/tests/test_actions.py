import pytest

from app.actions import ActionStore


def test_create_returns_pending_action_with_uuid():
    store = ActionStore()

    action = store.create("restart", "abc123", "Restart container es-node")

    assert action.status == "pending"
    assert action.action_type == "restart"
    assert action.container_id == "abc123"
    assert action.description == "Restart container es-node"
    assert len(action.action_id) > 0


def test_get_pending_returns_none_when_store_is_empty():
    store = ActionStore()

    assert store.get_pending() is None


def test_get_pending_returns_the_open_action():
    store = ActionStore()
    action = store.create("stop", "abc123", "Stop container es-node")

    assert store.get_pending() is action


def test_get_pending_returns_none_after_resolution():
    store = ActionStore()
    action = store.create("stop", "abc123", "Stop container es-node")
    store.resolve(action.action_id, "rejected")

    assert store.get_pending() is None


def test_get_returns_none_for_unknown_id():
    store = ActionStore()

    assert store.get("nope") is None


def test_get_returns_created_action():
    store = ActionStore()
    created = store.create("stop", "abc123", "Stop container es-node")

    fetched = store.get(created.action_id)

    assert fetched is created


def test_resolve_updates_status_and_result():
    store = ActionStore()
    created = store.create("start", "abc123", "Start container es-node")

    resolved = store.resolve(created.action_id, "approved", {"ok": True})

    assert resolved.status == "approved"
    assert resolved.result == {"ok": True}
    assert store.get(created.action_id).status == "approved"


def test_resolve_unknown_id_raises():
    store = ActionStore()

    with pytest.raises(ValueError, match="not found"):
        store.resolve("nope", "approved")


def test_resolve_already_resolved_raises():
    store = ActionStore()
    created = store.create("remove", "abc123", "Remove container es-node")
    store.resolve(created.action_id, "rejected")

    with pytest.raises(ValueError, match="already resolved"):
        store.resolve(created.action_id, "approved")


def test_pending_action_expires_after_ttl():
    store = ActionStore(ttl_seconds=0)
    created = store.create("stop", "abc123", "Stop container es-node")

    assert store.get_pending() is None
    assert store.get(created.action_id).status == "expired"


def test_expired_action_does_not_block_new_proposals():
    store = ActionStore(ttl_seconds=0)
    store.create("stop", "abc123", "Stop container es-node")

    assert store.get_pending() is None


def test_resolve_after_expiry_raises():
    store = ActionStore(ttl_seconds=0)
    created = store.create("stop", "abc123", "Stop container es-node")

    with pytest.raises(ValueError, match="expired"):
        store.resolve(created.action_id, "approved")
