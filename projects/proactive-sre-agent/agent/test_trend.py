from trend import linear_slope, project


def test_linear_slope_is_zero_for_fewer_than_two_samples():
    assert linear_slope([]) == 0.0
    assert linear_slope([(1.0, 5.0)]) == 0.0


def test_linear_slope_is_zero_for_flat_series():
    samples = [(1.0, 3.0), (2.0, 3.0), (3.0, 3.0)]

    assert linear_slope(samples) == 0.0


def test_linear_slope_detects_climbing_trend():
    samples = [(0.0, 0.0), (1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]

    assert linear_slope(samples) == 2.0


def test_linear_slope_detects_falling_trend():
    samples = [(0.0, 10.0), (1.0, 8.0), (2.0, 6.0)]

    assert linear_slope(samples) == -2.0


def test_linear_slope_is_zero_when_all_timestamps_identical():
    samples = [(5.0, 1.0), (5.0, 2.0), (5.0, 3.0)]

    assert linear_slope(samples) == 0.0


def test_project_adds_slope_times_lookahead():
    assert project(current_value=4.0, slope=2.0, lookahead_seconds=3.0) == 10.0


def test_project_with_zero_slope_returns_current_value():
    assert project(current_value=4.0, slope=0.0, lookahead_seconds=10.0) == 4.0


def test_project_with_negative_slope_decreases():
    assert project(current_value=10.0, slope=-1.0, lookahead_seconds=4.0) == 6.0
