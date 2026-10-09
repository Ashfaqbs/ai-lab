from unittest.mock import patch, Mock

import pytest

from measure import query_range, first_crossing, compute_lead_time


def _prometheus_response(pairs: list[tuple[float, float]]) -> dict:
    return {
        "status": "success",
        "data": {
            "result": [
                {"values": [[ts, str(value)] for ts, value in pairs]}
            ]
        },
    }


@patch("measure.requests.get")
def test_query_range_parses_response(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = _prometheus_response([(1.0, 5.0), (2.0, 7.0)])
    mock_get.return_value.raise_for_status.return_value = None

    series = query_range("http://localhost:9090", "up", 1.0, 2.0, 1.0)

    assert series == [(1.0, 5.0), (2.0, 7.0)]
    mock_get.assert_called_once_with(
        "http://localhost:9090/api/v1/query_range",
        params={"query": "up", "start": 1.0, "end": 2.0, "step": 1.0},
        timeout=10,
    )


@patch("measure.requests.get")
def test_query_range_returns_empty_list_when_no_data(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = {"status": "success", "data": {"result": []}}
    mock_get.return_value.raise_for_status.return_value = None

    series = query_range("http://localhost:9090", "nonexistent_metric", 1.0, 2.0, 1.0)

    assert series == []


@patch("measure.requests.get")
def test_query_range_raises_when_query_matches_multiple_series(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = {
        "status": "success",
        "data": {
            "result": [
                {"values": [["1.0", "5.0"]]},
                {"values": [["1.0", "7.0"]]},
            ]
        },
    }
    mock_get.return_value.raise_for_status.return_value = None

    with pytest.raises(ValueError, match="matched 2 series"):
        query_range("http://localhost:9090", "stress_active_cpu_tasks", 1.0, 2.0, 1.0)


@patch("measure.requests.get")
def test_query_range_skips_nan_values(mock_get: Mock) -> None:
    mock_get.return_value.json.return_value = {
        "status": "success",
        "data": {"result": [{"values": [["1.0", "NaN"], ["2.0", "5.0"]]}]},
    }
    mock_get.return_value.raise_for_status.return_value = None

    series = query_range("http://localhost:9090", "some_quantile", 1.0, 2.0, 1.0)

    assert series == [(2.0, 5.0)]


def test_first_crossing_detects_threshold() -> None:
    series = [(1.0, 0.0), (2.0, 3.0), (3.0, 10.0)]

    assert first_crossing(series, threshold=5.0) == 3.0


def test_first_crossing_returns_none_when_never_crosses() -> None:
    series = [(1.0, 0.0), (2.0, 1.0)]

    assert first_crossing(series, threshold=5.0) is None


def test_compute_lead_time_positive_when_leading_crosses_before_lagging() -> None:
    leading = [(1.0, 0.0), (2.0, 10.0)]
    lagging = [(1.0, 0.0), (2.0, 0.0), (5.0, 10.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["lead_time_seconds"] == 3.0
    assert result["status"] == "ok"


def test_compute_lead_time_reports_no_data_when_series_empty() -> None:
    result = compute_lead_time([], 5.0, [(1.0, 10.0)], 5.0)

    assert result["status"] == "no_data"
    assert result["lead_time_seconds"] is None


def test_compute_lead_time_reports_never_crossed_when_lagging_never_breaches() -> None:
    leading = [(1.0, 10.0)]
    lagging = [(1.0, 0.0), (2.0, 1.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["status"] == "lagging_never_crossed"
    assert result["lead_time_seconds"] is None


def test_compute_lead_time_reports_already_breached_when_lagging_starts_above_threshold() -> None:
    leading = [(1.0, 0.0), (2.0, 10.0)]
    lagging = [(1.0, 10.0), (2.0, 10.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["status"] == "already_breached"
    assert result["lead_time_seconds"] is None


def test_compute_lead_time_reports_lagging_crossed_first_with_negative_lead() -> None:
    leading = [(1.0, 0.0), (5.0, 10.0)]
    lagging = [(1.0, 0.0), (2.0, 10.0), (5.0, 10.0)]

    result = compute_lead_time(leading, 5.0, lagging, 5.0)

    assert result["status"] == "lagging_crossed_first"
    assert result["lead_time_seconds"] == -3.0
