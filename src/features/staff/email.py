"""Email behind a provider interface. Default 'outbox' stores the message (Sent (demo)).
Resend is used when RESEND_API_KEY is set; on failure the message is still kept in the outbox."""
import os
from datetime import datetime, timezone

from src.shared.config import DEMO_EMAIL_TO, EMAIL_FROM, LABELS


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class OutboxProvider:
    name = "outbox"

    def send(self, to, subject, body):
        return "Sent (demo)"


class ResendProvider:
    name = "resend"

    def send(self, to, subject, body):
        import httpx
        r = httpx.post("https://api.resend.com/emails", timeout=20,
                       headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}"},
                       json={"from": EMAIL_FROM, "to": [to], "subject": subject, "text": body})
        if r.status_code >= 400:
            raise RuntimeError(f"Resend HTTP {r.status_code}: {r.text[:200]}")
        return "Sent"


def get_provider():
    return ResendProvider() if os.getenv("RESEND_API_KEY") else OutboxProvider()


def compose(decision: str, s: dict, fields: list[str], note: str | None, resume_url: str | None):
    f = s["fields"]
    name, contact = f.get("business_name", "there"), f.get("contact_name", "")
    greet = f"Hi {contact}," if contact else "Hello,"
    if decision == "approve":
        subject = f"{name}: your onboarding is approved"
        text = "Great news, your onboarding has been approved.\n\nOur operations team will get in contact with you soon."
    elif decision == "reject":
        subject = f"{name}: update on your onboarding"
        text = ("Thank you for taking the time to register with us. After reviewing your details, we're unable to "
                "proceed with your onboarding at this time.\n\nWe appreciate your interest and wish you all the best.")
    else:
        subject = f"{name}: we need a little more information"
        items = "\n".join(f"  - {LABELS.get(k, k)}" for k in fields) or "  - (see note)"
        text = (f"To complete your onboarding, please provide or update:\n{items}\n"
                + (f"\nNote from our team: {note}\n" if note else "")
                + f"\nContinue here: {resume_url}")
    if note and decision != "more_info":
        text += f"\n\nNote from our team: {note}"
    body = f"{greet}\n\n{text}\n\nClient email on file: {f.get('email', '(none)')}\n\nThe Onboarding Team"
    return subject, body


def send(decision, s, fields, note, resume_url):
    subject, body = compose(decision, s, fields, note, resume_url)
    prov = get_provider()
    try:
        status = prov.send(DEMO_EMAIL_TO, subject, body)
    except Exception as e:
        print(f"[email] {prov.name} failed, kept in outbox: {e}")
        status, prov = f"Sent (demo), {prov.name} failed: {str(e)[:120]}", OutboxProvider()
    return {"to": DEMO_EMAIL_TO, "subject": subject, "body": body, "sent_at": _now(),
            "status": status, "provider": prov.name}
