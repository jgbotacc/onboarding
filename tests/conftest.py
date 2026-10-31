"""Shared test env: a placeholder notify address so staff emails have a recipient."""
import os

os.environ.setdefault("ONBOARDING_NOTIFY_EMAIL", "ops@example.com")
