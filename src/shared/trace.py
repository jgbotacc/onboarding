"""Step traces: {session_id, step, model, ok, latency_ms, cost_sgd, error, at}."""
import logging
import os
import time
from datetime import datetime, timezone

from src.shared.guard import scrub_nric

USD_SGD = float(os.getenv("USD_SGD", "1.35"))
IMAGE_USD = 0.01

_sink = None


def usd_to_sgd(usd: float) -> float:
    """Convert USD to SGD, rounded to 6 dp."""
    return round(usd * USD_SGD, 6)


def set_sink(fn):
    """Pluggable trace sink; fn(row) is called on every record(). None disables."""
    global _sink
    _sink = fn


def record(step, model, ok, latency_ms, cost_sgd=0.0, session_id=None, error=None):
    """Build a trace row, log it, and pass it to the sink. Never raises."""
    log = logging.getLogger("onboarding")
    row = {"session_id": session_id, "step": step, "model": model, "ok": bool(ok),
           "latency_ms": int(latency_ms), "cost_sgd": cost_sgd,
           "error": scrub_nric(str(error))[:200] if error is not None else None,
           "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    (log.info if row["ok"] else log.warning)("trace %s %s ok=%s %dms cost=%.6f",
                                              step, model, row["ok"], row["latency_ms"], cost_sgd or 0.0)
    if _sink is not None:
        try:
            _sink(row)
        except Exception as e:
            log.warning("trace sink failed: %s", e)
    return row


class _Timer:
    def __enter__(self):
        self._t = time.perf_counter()
        return self

    def __exit__(self, *a):
        self.ms = int((time.perf_counter() - self._t) * 1000)
        return False


def timer():
    """Context manager; elapsed ms available as `.ms` after the block."""
    return _Timer()
