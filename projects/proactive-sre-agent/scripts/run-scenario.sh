#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${1:-}"
if [[ -z "${SCENARIO}" ]]; then
  echo "Usage: run-scenario.sh <normal-load|cpu-stress|db-hold-stress>"
  exit 1
fi

K6_DIR="projects/proactive-sre-agent/k6"
K8S_DIR="projects/proactive-sre-agent/k8s"
NAMESPACE="ailab-poc"

# Regenerate the ConfigMap from the real .js source files, so it can never drift.
{
  echo "apiVersion: v1"
  echo "kind: ConfigMap"
  echo "metadata:"
  echo "  name: k6-scripts"
  echo "  namespace: ${NAMESPACE}"
  echo "data:"
  for f in normal-load cpu-stress db-hold-stress; do
    echo "  ${f}.js: |"
    sed 's/^/    /' "${K6_DIR}/${f}.js"
  done
} > "${K8S_DIR}/60-k6-scripts-configmap.generated.yaml"

kubectl apply -f "${K8S_DIR}/60-k6-scripts-configmap.generated.yaml"

kubectl -n "${NAMESPACE}" delete job k6-run --ignore-not-found
sed "s/SCENARIO_PLACEHOLDER/${SCENARIO}/" "${K8S_DIR}/61-k6-job.yaml" | kubectl apply -f -

kubectl -n "${NAMESPACE}" wait --for=condition=complete job/k6-run --timeout=180s
kubectl -n "${NAMESPACE}" logs job/k6-run
