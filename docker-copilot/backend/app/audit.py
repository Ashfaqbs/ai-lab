import json
import time
from pathlib import Path

AUDIT_LOG_PATH = Path(__file__).resolve().parent.parent / "audit.log"


def log_event(event_type: str, **fields: object) -> None:
    """Append an immutable audit record for a proposal/approval/rejection.

    Production approval-gate systems (see e.g. SOC 2 / GDPR processing-record
    requirements) keep a durable trail of who decided what and when,
    independent of in-memory state that a restart would lose. This is the
    minimal POC equivalent: one JSON line per event, append-only.
    """
    entry = {"event": event_type, "timestamp": time.time(), **fields}
    with AUDIT_LOG_PATH.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
