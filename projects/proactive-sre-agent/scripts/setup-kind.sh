#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="ailab-poc"

if ! command -v kind >/dev/null 2>&1; then
  echo "kind not found. Install: https://kind.sigs.k8s.io/docs/user/quick-start/#installation"
  exit 1
fi

if kind get clusters | grep -qx "${CLUSTER_NAME}"; then
  echo "kind cluster '${CLUSTER_NAME}' already exists, skipping create"
else
  kind create cluster --name "${CLUSTER_NAME}"
fi

kubectl config use-context "kind-${CLUSTER_NAME}"

# metrics-server is required for the demo-api HPA (Task 7) to read live CPU usage.
# kind's kubelet serving certs aren't verified by the default metrics-server manifest,
# so we patch in --kubelet-insecure-tls (acceptable for a local lab cluster only).
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl patch -n kube-system deployment metrics-server --type=json \
  -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]'

echo "kind cluster '${CLUSTER_NAME}' ready, metrics-server patched for insecure TLS."
