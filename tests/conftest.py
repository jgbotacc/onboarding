"""Shared test env: a placeholder notify address and a fixed staff passcode (staff routes fail closed without one)."""
import os

os.environ.setdefault("ONBOARDING_NOTIFY_EMAIL", "ops@example.com")
os.environ.setdefault("STAFF_PASSCODE", "test-staff-key")

# Chat tests stay offline: provider choice is driven by env, so drop any
# ambient Baseten selection. Individual tests set what they need.
for _k in ("BASETEN_API_KEY", "CHAT_PROVIDER"):
    os.environ.pop(_k, None)
