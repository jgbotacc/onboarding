"""Staff metrics per PRD 3.1 / 3.5 / section 6."""
from datetime import datetime

DONE = {"accepted", "approved", "rejected", "pending_review"}


def _parse(ts):
    """ISO or SQLite 'YYYY-MM-DD HH:MM:SS' -> aware datetime, else None."""
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=datetime.now().astimezone().tzinfo)
    except Exception:
        pass
    try:
        d = datetime.strptime(str(ts), "%Y-%m-%d %H:%M:%S")
        return d.replace(tzinfo=datetime.now().astimezone().tzinfo)
    except Exception:
        return None


def _minutes(start, end):
    a, b = _parse(start), _parse(end)
    return (b - a).total_seconds() / 60 if a and b else None


def compute(store) -> dict:
    states = [s for s in store.list_states() if (s.get("fields") or {}).get("business_name")]
    n = len(states)
    done = [s for s in states if s.get("status") in DONE]
    # time to finish: started (or first event) -> updated, completed only
    mins = []
    for s in done:
        start = s.get("started")
        if not start and hasattr(store, "events_for"):
            try:
                evs = store.events_for(s["id"])
                start = evs[0].get("created_at") if evs else None
            except Exception:
                start = None
        m = _minutes(start, s.get("updated"))
        if m is not None:
            mins.append(m)
    picked = [s for s in states if s.get("selected_looks") or s.get("status") == "accepted"]
    saw_round = [s for s in states if (s.get("round") or 0) >= 1]
    handed = [s for s in states if s.get("status") == "handed_off"]
    outcomes = {
        "sessions": n,
        "completed": len(done),
        "completion_rate": round(len(done) / n, 3) if n else 0,
        "avg_minutes_to_finish": (sum(mins) / len(mins) if mins else None),
        "avg_fields_needing_fixes": (sum(len(s.get("fixes") or []) for s in states) / n if n else 0),
        "avg_rounds_to_pick": (sum(s.get("round") or 0 for s in picked) / len(picked) if picked else None),
        "consult_rate": round(len(handed) / len(saw_round), 3) if saw_round else 0,
    }
    # steps grouped by (step, model)
    groups: dict[tuple, dict] = {}
    total = 0.0
    for t in store.all_traces():
        key = (t.get("step"), t.get("model"))
        g = groups.setdefault(key, {"calls": 0, "ok": 0, "lat": 0, "cost": 0.0})
        g["calls"] += 1
        g["ok"] += 1 if t.get("ok") else 0
        g["lat"] += t.get("latency_ms") or 0
        g["cost"] += t.get("cost_sgd") or 0.0
        total += t.get("cost_sgd") or 0.0
    steps = [{"step": k[0], "model": k[1], "calls": g["calls"],
              "ok_rate": round(g["ok"] / g["calls"], 3) if g["calls"] else 0,
              "avg_latency_ms": round(g["lat"] / g["calls"], 1) if g["calls"] else 0,
              "cost_sgd": round(g["cost"], 4)} for k, g in sorted(groups.items(), key=str)]
    errors = [{"step": t.get("step"), "model": t.get("model"), "error": t.get("error"), "at": t.get("at")}
              for t in store.all_traces() if not t.get("ok")][:20]
    ev = store.latest_evals() or {}
    doc = ev.get("doc_extraction_accuracy") or ev.get("doc_extraction") or ev.get("doc")
    img = ev.get("image_fit") or ev.get("image")
    evals = None if not ev else {
        "doc_extraction_accuracy": (doc or {}).get("score"),
        "image_fit": (img or {}).get("score"),
        "n": (doc or img or {}).get("n"),
        "at": (doc or img or {}).get("at"),
    }
    return {"outcomes": outcomes, "steps": steps, "total_cost_sgd": round(total, 4),
            "errors": errors, "evals": evals}
