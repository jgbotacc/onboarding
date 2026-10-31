"""Shared test helpers: clients that send the staff key and track the current session secret."""
import os

from fastapi.testclient import TestClient


def staff_client(app):
    return TestClient(app, headers={"x-staff-key": os.environ["STAFF_PASSCODE"]})


def new_session(c):
    """Create a session and send its secret on every later request from this client."""
    r = c.post("/api/session", json={}).json()
    c.headers["x-session-secret"] = r["sessionSecret"]
    return r["sessionId"]


def resume(c, token):
    """Open a resume link; on success switch this client to the new session secret."""
    r = c.post("/api/session", json={"resumeToken": token})
    if r.status_code == 200:
        c.headers["x-session-secret"] = r.json()["sessionSecret"]
    return r
