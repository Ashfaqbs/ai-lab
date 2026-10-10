"""Reads and changes a Deployment's replica count via the Kubernetes API.

This stands in for what a real Kubernetes MCP server's scale tool would do for an LLM
reasoning step. See DECISIONS.md (2026-10-09, "Phase 2 scope ruling") for why this agent
calls the Kubernetes API directly instead of standing up a live MCP server + LLM loop:
swapping this function's body for a real MCP tool call is a contained follow-up."""

from kubernetes.client import AppsV1Api


def get_replica_count(apps_v1: AppsV1Api, namespace: str, deployment: str) -> int:
    scale = apps_v1.read_namespaced_deployment_scale(deployment, namespace)
    return scale.spec.replicas


def scale_deployment(
    apps_v1: AppsV1Api, namespace: str, deployment: str, replicas: int
) -> int:
    """Patches the deployment's replica count. Returns the replica count that was set."""
    apps_v1.patch_namespaced_deployment_scale(
        deployment, namespace, {"spec": {"replicas": replicas}}
    )
    return replicas
