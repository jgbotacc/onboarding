"""Runtime config from env vars only (no secrets in code)."""
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("APP_DATA_DIR", Path(__file__).resolve().parents[2] / "var"))
MEDIA_DIR = DATA_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DATA_DIR / "onboarding.sqlite3"
MAX_ROUNDS = 3

# Source of truth: Docs/b2b-registration-form.html (* = mandatory)
MANDATORY = [
    ("business_name", "Business Name"),
    ("contact_name", "Contact Name"),
    ("email", "Email"),
]
OPTIONAL = [
    ("business_type", "Business Type"), ("industry", "Industry"), ("business_website", "Business Website"),
    ("title_position", "Title/Position"), ("phone_number", "Phone Number"),
    ("design_preferences", "Design Preferences"), ("expected_annual_revenue", "Expected Annual Revenue"),
    ("requirements_notes", "Requirements / Notes"),
]
FORM_KEYS = [k for k, _ in MANDATORY + OPTIONAL]
LABELS = dict(MANDATORY + OPTIONAL)


def neo4j_env():
    uri, user, pw = os.getenv("NEO4J_URI"), os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD")
    return (uri, user, pw) if uri and user and pw else None

# Every outgoing staff-decision email goes to this one address; the client's email is shown in the body.
# Read at send time. If unset, emails are composed and kept in the outbox but not sent.
NOTIFY_EMAIL_ENV = "ONBOARDING_NOTIFY_EMAIL"


def notify_email_to() -> str:
    return os.getenv(NOTIFY_EMAIL_ENV, "").strip()


EMAIL_FROM = os.getenv("EMAIL_FROM", "Onboarding <onboarding@resend.dev>")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "")
