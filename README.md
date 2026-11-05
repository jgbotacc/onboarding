# Onboarding Agent

[Watch the demo video](https://www.youtube.com/watch?v=WP5Iw92599A)

## What it does
AI-assisted onboarding chat for small businesses. A client uploads a PDF or phone photo with business details, the agent pulls out the fields, asks only for what is still missing, and shows marketing mockups to get a sense of client's design preferences. If nothing is picked, it hands off to staff for a consult.

## Why it is smoother for a non-tech-savvy business owner
- Short replies, one idea per line, each can be read aloud.
- English, Chinese, Malay, Tamil. Different languages catering to the various ethnics groups in Singapore The client picks their preferred.
- PDF or phone photo upload (JPG, PNG, HEIC). Non-standard documents can be uploaded as well (such an ACRA business profile), the system then asks only for missing fields.

## How it works (Client)
1. Read document: text or photo in, candidate fields out. Read-only.
2. Find gaps: compare against mandatory field list
3. Ask only missing: one short line per field.
4. Make image brief: three briefs from confirmed fields, design direction, and gather rejected looks.
5. Relay: Preferences relayed to the staff

## How it works (Staff)
1. Sign in: open /staff, enter the password ('Staff'), Continue.
2. Onboarding: open a client, read Chat history and Business details.
3. Drafts under review: tell the assistant what to change. Generate 3 drafts, Remix, Pin to client, Pin to consult, Send to client.
4. Send to designers: Send to designers, case moves to Sent to designers.

## How it works (Designers)
1. Sign in: open /staff, enter the password ('Designer'), Continue.
2. One line per case: Business name, Design preferences, Chosen look.
3. Download images: zip of the case images.
4. Upload final images: JPG or PNG, status becomes Done.

## How to run it
Backend:
```
pip install -r requirements.txt
uvicorn src.app:app --port 8000
```
Front end build:
```
cd web
npm install
npm run build
```
Tests (they never call Meta; leave `MODEL_API_KEY` unset):
```
pytest -q tests
cd web
npm test
```
Env vars, by name only:
- `MODEL_API_KEY` (Meta Model API: Muse Spark and Muse Image; without it the app uses regex reading, English only and placeholder images)
- `STAFF_PASSCODE` (staff pages and API at `/staff`)
- `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` optional, SQLite fallback in `var/` if not set
- `ONBOARDING_NOTIFY_EMAIL`, `RESEND_API_KEY` optional

## Docs (used for spec driven development)
- [Docs/PRD.md](Docs/PRD.md)
- [Docs/ASSUMPTIONS.md](Docs/ASSUMPTIONS.md)
- [Docs/UI-API-CONTRACT.md](Docs/UI-API-CONTRACT.md)
- [Docs/FILE-STRUCTURE.md](Docs/FILE-STRUCTURE.md)

## Demo details

- Client: https://8000-44729a7d-c953-4cf4-bb69-f3f43bd8d06a.daytonaproxy01.net/
- Staff: https://8000-44729a7d-c953-4cf4-bb69-f3f43bd8d06a.daytonaproxy01.net/staff
- Demo passwords: `staff` for the staff view, `designer` for the designer view.
- Staff and designers share the one /staff address; the password decides the view. /designer redirects there.
- Env var names only (see .env.example): STAFF_PASSCODE, DESIGNER_PASSCODE, MODEL_API_KEY, CHAT_PROVIDER, BASETEN_API_KEY, BASETEN_BASE_URL, BASETEN_MODEL, RESEND_API_KEY, ONBOARDING_NOTIFY_EMAIL, EMAIL_FROM, PUBLIC_BASE_URL, RELAY_URL, RELAY_SECRET, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD.
- Deploy: Daytona `python scripts/deploy_daytona.py` with DAYTONA_API_KEY in env; Vercel `vercel deploy` from the relay folder.
