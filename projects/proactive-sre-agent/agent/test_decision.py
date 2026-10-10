from decision import MetricWatch, decide, PAIN_THRESHOLD


def test_decide_none_when_flat_and_below_pain_threshold():
    watch = MetricWatch("test_metric", "some_query")
    watch.observe(0.0, 0.0)
    watch.observe(1.0, 0.0)

    result = decide(watch, lookahead_seconds=10.0)

    assert result["action"] == "none"


def test_decide_reactive_when_current_already_at_pain_threshold():
    watch = MetricWatch("test_metric", "some_query")
    watch.observe(0.0, PAIN_THRESHOLD)
    watch.observe(1.0, PAIN_THRESHOLD)

    result = decide(watch, lookahead_seconds=10.0)

    assert result["action"] == "scale"
    assert result["reason"] == "reactive"


def test_decide_proactive_when_trend_projects_a_breach_before_current_value_breaches():
    watch = MetricWatch("test_metric", "some_query")
    # Climbing 1.0/sec, currently at 1.0 (below PAIN_THRESHOLD=3.0), but projected to
    # hit 3.0 well within the 10s lookahead -- this is the actual "catch it before it
    # happens" case the whole project exists to demonstrate.
    watch.observe(0.0, 0.0)
    watch.observe(1.0, 1.0)

    result = decide(watch, lookahead_seconds=10.0)

    assert result["action"] == "scale"
    assert result["reason"] == "proactive"
    assert result["current"] < PAIN_THRESHOLD


def test_decide_none_when_trend_is_climbing_but_too_slowly_to_breach_within_lookahead():
    watch = MetricWatch("test_metric", "some_query")
    watch.observe(0.0, 0.0)
    watch.observe(1.0, 0.1)

    result = decide(watch, lookahead_seconds=5.0)

    assert result["action"] == "none"


def test_decide_none_when_falling_even_if_currently_elevated_but_below_pain():
    watch = MetricWatch("test_metric", "some_query")
    watch.observe(0.0, 2.5)
    watch.observe(1.0, 2.0)

    result = decide(watch, lookahead_seconds=10.0)

    assert result["action"] == "none"


def test_decide_none_with_empty_history():
    watch = MetricWatch("test_metric", "some_query")

    result = decide(watch, lookahead_seconds=10.0)

    assert result["action"] == "none"
    assert result["current"] == 0.0
