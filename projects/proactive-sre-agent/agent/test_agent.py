from argparse import Namespace
from unittest.mock import Mock, patch

from agent import build_watches, run_tick
from decision import PAIN_THRESHOLD


def _args(**overrides) -> Namespace:
    defaults = dict(
        prom_url="http://localhost:9090",
        namespace="ailab-poc",
        deployment="demo-api",
        job="demo-api",
        lookahead=10.0,
        cooldown=30.0,
        max_replicas=4,
    )
    defaults.update(overrides)
    return Namespace(**defaults)


def test_build_watches_formats_job_into_each_query():
    watches = build_watches("demo-api")

    assert all('job="demo-api"' in w.query for w in watches)


@patch("agent.scale_deployment")
@patch("agent.get_replica_count", return_value=1)
@patch("agent.read_metric", return_value=PAIN_THRESHOLD)
def test_run_tick_scales_up_when_a_metric_breaches(
    mock_read, mock_get_replicas, mock_scale
):
    watches = build_watches("demo-api")
    args = _args()

    record, last_action_at = run_tick(
        apps_v1=Mock(), watches=watches, args=args, last_action_at=0.0, now=100.0
    )

    assert record["action_taken"]["from_replicas"] == 1
    assert record["action_taken"]["to_replicas"] == 2
    mock_scale.assert_called_once()
    assert last_action_at == 100.0


@patch("agent.scale_deployment")
@patch("agent.get_replica_count", return_value=1)
@patch("agent.read_metric", return_value=PAIN_THRESHOLD)
def test_run_tick_skips_action_during_cooldown(
    mock_read, mock_get_replicas, mock_scale
):
    watches = build_watches("demo-api")
    args = _args(cooldown=30.0)

    record, last_action_at = run_tick(
        apps_v1=Mock(), watches=watches, args=args, last_action_at=90.0, now=100.0
    )

    assert record["action_taken"] == {"skipped": "cooldown"}
    mock_scale.assert_not_called()
    assert last_action_at == 90.0


@patch("agent.scale_deployment")
@patch("agent.get_replica_count", return_value=4)
@patch("agent.read_metric", return_value=PAIN_THRESHOLD)
def test_run_tick_skips_action_when_already_at_max_replicas(
    mock_read, mock_get_replicas, mock_scale
):
    watches = build_watches("demo-api")
    args = _args(max_replicas=4)

    record, last_action_at = run_tick(
        apps_v1=Mock(), watches=watches, args=args, last_action_at=0.0, now=100.0
    )

    assert record["action_taken"] == {"skipped": "already at max_replicas"}
    mock_scale.assert_not_called()


@patch("agent.scale_deployment")
@patch("agent.get_replica_count")
@patch("agent.read_metric", return_value=0.0)
def test_run_tick_takes_no_action_when_nothing_triggers(
    mock_read, mock_get_replicas, mock_scale
):
    watches = build_watches("demo-api")
    args = _args()

    record, last_action_at = run_tick(
        apps_v1=Mock(), watches=watches, args=args, last_action_at=0.0, now=100.0
    )

    assert "action_taken" not in record
    mock_scale.assert_not_called()
    mock_get_replicas.assert_not_called()
    assert last_action_at == 0.0


@patch("agent.scale_deployment")
@patch("agent.get_replica_count", return_value=1)
@patch("agent.read_metric", return_value=None)
def test_run_tick_handles_metric_with_no_data_without_crashing(
    mock_read, mock_get_replicas, mock_scale
):
    watches = build_watches("demo-api")
    args = _args()

    record, last_action_at = run_tick(
        apps_v1=Mock(), watches=watches, args=args, last_action_at=0.0, now=100.0
    )

    assert "action_taken" not in record
    assert all(d["current"] == 0.0 for d in record["decisions"])
