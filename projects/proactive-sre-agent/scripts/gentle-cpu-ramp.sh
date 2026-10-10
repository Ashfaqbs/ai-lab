#!/usr/bin/env bash
# A deliberately gradual load pattern for demonstrating proactive trend detection:
# k6's cpu-stress.js ramps fast enough to jump the pain threshold within one 5s
# Prometheus scrape, leaving no window for a trend-based agent to act ahead of it.
# This script instead issues one stress call every few seconds, with the interval
# shrinking over time, so stress_active_cpu_tasks climbs gradually across several
# scrape intervals -- a fairer test of trend-based *prediction*, not just reaction.
set -euo pipefail

TARGET_URL="${1:-http://localhost:18082}"
TASK_SECONDS=6

for interval in 4 4 3 3 2 2 1 1 1 1; do
  curl -s -o /dev/null -X POST "${TARGET_URL}/api/stress/cpu?seconds=${TASK_SECONDS}" || true
  sleep "${interval}"
done
