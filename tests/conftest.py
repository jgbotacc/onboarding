"""Shared test env: a placeholder notify address and a fixed staff passcode (staff routes fail closed without one)."""
import os

os.environ.setdefault("ONBOARDING_NOTIFY_EMAIL", "ops@example.com")
os.environ.setdefault("STAFF_PASSCODE", "test-staff-key")
