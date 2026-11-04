"""Shared test env: a placeholder notify address and a fixed staff passcode (staff routes fail closed without one)."""
import os

os.environ.setdefault("ONBOARDING_NOTIFY_EMAIL", "ops@example.com")
os.environ.setdefault("STAFF_PASSCODE", "test-staff-key")

# Chat tests stay offline: Baseten is tried first whenever BASETEN_API_KEY is
# set, so drop any ambient chat keys. Individual tests set what they need.
for _k in ("BASETEN_API_KEY", "BASETEN_DEPLOY_API_KEY", "MODEL_API_KEY", "META_API_KEY",
           "BASETEN_BASE_URL", "BASETEN_MODEL", "META_API_BASE", "META_CHAT_MODEL"):
    os.environ.pop(_k, None)
