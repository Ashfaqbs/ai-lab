from unittest.mock import MagicMock

from app import docker_tools


def _mock_container(id_, name, image_tag, status):
    c = MagicMock()
    c.id = id_
    c.name = name
    c.image.tags = [image_tag]
    c.status = status
    c.ports = {}
    return c


def test_list_containers_returns_summary(mocker):
    client = MagicMock()
    client.containers.list.return_value = [
        _mock_container("abc123", "es-node", "elasticsearch:8.13.4", "running"),
    ]
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.list_containers()

    assert result == [
        {
            "id": "abc123",
            "name": "es-node",
            "image": "elasticsearch:8.13.4",
            "status": "running",
        }
    ]
    client.containers.list.assert_called_once_with(all=True)


def test_inspect_container_returns_trimmed_fields(mocker):
    client = MagicMock()
    container = MagicMock()
    container.attrs = {
        "Id": "abc123",
        "Name": "/es-node",
        "State": {"Status": "running", "StartedAt": "2026-08-07T00:00:00Z"},
        "Config": {"Image": "elasticsearch:8.13.4", "Env": ["SECRET=x"]},
        "NetworkSettings": {"Ports": {"9200/tcp": [{"HostPort": "9200"}]}},
    }
    client.containers.get.return_value = container
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.inspect_container("abc123")

    assert result == {
        "id": "abc123",
        "name": "/es-node",
        "status": "running",
        "started_at": "2026-08-07T00:00:00Z",
        "image": "elasticsearch:8.13.4",
        "ports": {"9200/tcp": [{"HostPort": "9200"}]},
    }


def test_inspect_container_not_found_returns_error(mocker):
    import docker.errors

    client = MagicMock()
    client.containers.get.side_effect = docker.errors.NotFound("no such container")
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.inspect_container("missing")

    assert result == {"error": "Container 'missing' not found."}


def test_get_logs_returns_decoded_text(mocker):
    client = MagicMock()
    container = MagicMock()
    container.logs.return_value = b"line1\nline2\n"
    client.containers.get.return_value = container
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.get_logs("abc123", tail=50)

    assert result == "line1\nline2\n"
    container.logs.assert_called_once_with(tail=50)


def test_get_stats_returns_cpu_and_memory(mocker):
    client = MagicMock()
    container = MagicMock()
    container.stats.return_value = {
        "cpu_stats": {
            "cpu_usage": {"total_usage": 200},
            "system_cpu_usage": 1000,
            "online_cpus": 2,
        },
        "precpu_stats": {
            "cpu_usage": {"total_usage": 100},
            "system_cpu_usage": 800,
        },
        "memory_stats": {"usage": 104857600, "limit": 1073741824},
    }
    client.containers.get.return_value = container
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.get_stats("abc123")

    assert result["memory_usage_mb"] == 100.0
    assert result["memory_limit_mb"] == 1024.0
    assert result["cpu_percent"] == 100.0


def test_propose_restart_creates_pending_action(mocker):
    client = MagicMock()
    client.containers.get.return_value = MagicMock(name="es-node")
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    from app.actions import ActionStore
    store = ActionStore()
    mocker.patch("app.docker_tools.get_action_store", return_value=store)

    result = docker_tools.propose_restart("abc123")

    assert "awaiting the human's decision" in result.lower()
    pending = list(store._actions.values())
    assert len(pending) == 1
    assert pending[0].action_type == "restart"
    assert pending[0].container_id == "abc123"
    assert pending[0].status == "pending"
    client.containers.start.assert_not_called()


def test_propose_stop_container_not_found_returns_error(mocker):
    import docker.errors

    client = MagicMock()
    client.containers.get.side_effect = docker.errors.NotFound("no such container")
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    result = docker_tools.propose_stop("missing")

    assert result == "Container 'missing' not found."


def test_propose_refuses_second_action_while_one_is_open(mocker):
    client = MagicMock()
    client.containers.get.return_value = MagicMock(name="es-node")
    mocker.patch("app.docker_tools.get_docker_client", return_value=client)

    from app.actions import ActionStore
    store = ActionStore()
    mocker.patch("app.docker_tools.get_action_store", return_value=store)

    first = docker_tools.propose_stop("abc123")
    second = docker_tools.propose_restart("xyz789")

    assert "awaiting the human's decision" in first.lower()
    assert "already an open request" in second.lower()
    assert len(store._actions) == 1
