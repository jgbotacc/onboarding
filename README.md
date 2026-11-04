# Onboarding Agent

Client onboarding for small firms. A client uploads a document or fills in a short form, the app runs checks, shows three design drafts, then staff review the case and hand it to a designer.

## Live demo

- Client: https://8000-44729a7d-c953-4cf4-bb69-f3f43bd8d06a.daytonaproxy01.net/
- Staff: https://8000-44729a7d-c953-4cf4-bb69-f3f43bd8d06a.daytonaproxy01.net/staff

Staff and designers use the same /staff address; the password decides the view. /designer just redirects there.

Password "staff" opens the staff view. Password "designer" opens the designer view.

This is just a demo. Change these before real use. They are set by the STAFF_PASSCODE and DESIGNER_PASSCODE env vars.

## Run locally

```
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd web && npm ci && npm run build && cd ..
uvicorn src.app:app --port 8000
```

Env vars, by name only (see .env.example): STAFF_PASSCODE, DESIGNER_PASSCODE, MODEL_API_KEY, RESEND_API_KEY, ONBOARDING_NOTIFY_EMAIL, EMAIL_FROM, PUBLIC_BASE_URL, RELAY_URL, RELAY_SECRET, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.

## AI

Text and vision go through Baseten (meta-models/muse-spark-open-1026) with Meta as automatic fallback. Image generation is on Meta.

## Deploy

- Daytona: `python scripts/deploy_daytona.py` with DAYTONA_API_KEY in env.
- Vercel: relay folder, `vercel deploy`; paused by default.

## Tests

```
pytest -q
cd web && npm test
```
