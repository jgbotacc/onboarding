"""Test env: a fixed staff passcode (staff routes fail closed without one)."""
import os

os.environ.setdefault("STAFF_PASSCODE", "test-staff-key")
