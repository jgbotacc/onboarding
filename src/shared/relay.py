"""Optional HTTPS relay (Vercel) for outbound calls the Daytona sandbox can't make directly.
Enabled when RELAY_URL and RELAY_SECRET are both set."""
import os

import httpx


def enabled() -> bool:
    return bool(os.getenv("RELAY_URL") and os.getenv("RELAY_SECRET"))


def url(path: str) -> str:
    return os.environ["RELAY_URL"].rstrip("/") + path


def headers() -> dict:
    return {"x-relay-secret": os.environ["RELAY_SECRET"]}


def post(path: str, json=None, timeout=60, client: httpx.Client | None = None) -> httpx.Response:
    return (client or httpx).post(url(path), json=json, headers=headers(), timeout=timeout)
