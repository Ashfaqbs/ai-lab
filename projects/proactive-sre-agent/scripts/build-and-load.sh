#!/usr/bin/env bash
set -euo pipefail

IMAGE="ailab/demo-api:local"
CLUSTER_NAME="ailab-poc"

docker build -t "${IMAGE}" projects/proactive-sre-agent/demo-api
kind load docker-image "${IMAGE}" --name "${CLUSTER_NAME}"

echo "Built and loaded ${IMAGE} into kind cluster ${CLUSTER_NAME}."
