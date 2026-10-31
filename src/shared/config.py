"""Runtime config from env vars only (no secrets in code)."""
import os
from pathlib import Path

DATA_DIR = Path(os.getenv("APP_DATA_DIR", Path(__file__).resolve().parents[2] / "var"))
MEDIA_DIR = DATA_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
SQLITE_PATH = DATA_DIR / "onboarding.sqlite3"
MAX_ROUNDS = 3

MANDATORY = [
    ("company_name", "Company name"),
    ("address", "Address"),
    ("contact", "Contact email or phone"),
    ("industry", "Industry"),
]
OPTIONAL = [("tagline", "Marketing tagline"), ("brand_colours", "Brand colours"), ("logo", "Logo")]
LABELS = dict(MANDATORY + OPTIONAL)


def neo4j_env():
    uri, user, pw = os.getenv("NEO4J_URI"), os.getenv("NEO4J_USERNAME"), os.getenv("NEO4J_PASSWORD")
    return (uri, user, pw) if uri and user and pw else None
