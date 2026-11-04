# Onboarding Agent (v2)

## What it does
AI-assisted onboarding chat for small businesses. A client uploads a PDF or phone photo with business details, the agent pulls out the fields, asks only for what is still missing, and shows three square (1080x1080) marketing looks per round for up to 3 rounds. If nothing is picked, it hands off to staff for a consult.

## Why it is smoother for a non-tech-savvy business owner
- Short replies, one idea per line, each can be read aloud.
- English, Chinese, Malay, Tamil. The client picks one or it is detected.
- PDF or phone photo upload (JPG, PNG, HEIC). Shows what was found for confirm, then asks only for missing fields.
- A confirm card with editable values and a Listen button; a mic button for spoken answers.
- Pick one or more looks, or skip for a new set. Plain consult message in their own language if no pick.
- Save and resume in the same browser or with a private resume link. A file can be deleted before anything is saved.
- Every reply has a next step, so there is no dead end.

## What's new in v2
- General document upload, including ACRA business profile photos, with confirm-before-save.
- Four languages with English stored for staff and original text kept.
- Three looks per round, pick or skip, up to 3 rounds. Rejected looks stored with round number.
- Consult handoff: client message plus staff consult card with submitted details and next steps. No email alert for consults.
- Staff views for clients, consults, rejected looks, metrics, traces, audit, and an email preview before a staff decision sends it.
- Every model step traced with timing and cost in S$. NRIC numbers are dropped at reading and masked on the way out, as is any other client's email, phone or UEN.

## How it works
One agent runs fixed steps:
1. Read document: text or photo in, candidate fields out. Read-only.
2. Find gaps: compare against field list, mandatory first.
3. Ask only missing: one short line per field.
4. Make image brief: three briefs from confirmed fields, design direction, and rejected looks.
5. Generate: one image per brief.
6. Self-check: image exists, is 1080x1080, and decodes. A look that fails the check is replaced by a labelled placeholder.
- On model failure: retry twice with backoff, then fall back to non-AI path or ask a plain question.

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

## Staff image studio
Staff-only Studio tab per client: runs 3 drafts per run from the client brief, with remix of a draft or a rejected look. Rejected looks steer the prompt away (best effort, prompt text only). Drafts can be starred, pinned to the client or consult card, and sent to the client, where they appear as "Suggested by our team". Cap is 9 drafts per client. Drafts are staff-only until sent; every studio action is written to the audit log.
Routes (all under `/api/staff`, staff passcode applies):
- `GET /api/staff/clients/{cid}/studio`
- `POST /api/staff/clients/{cid}/studio/drafts`
- `POST /api/staff/clients/{cid}/studio/remix`
- `POST /api/staff/clients/{cid}/studio/drafts/{did}/star`
- `POST /api/staff/clients/{cid}/studio/drafts/{did}/pin`
- `POST /api/staff/clients/{cid}/studio/drafts/{did}/send`
To try it without a backend, open the staff page with `?mock=1` for demo data.
Designer handoff page at `/designer` (staff passcode, or the `DESIGNER_PASSCODE` designer passcode): one row per case sent to designers, with an image zip download, final-image upload, and Done/Pending status.

## Docs
- [Docs/PRD.md](Docs/PRD.md)
- [Docs/ASSUMPTIONS.md](Docs/ASSUMPTIONS.md)
- [Docs/UI-API-CONTRACT.md](Docs/UI-API-CONTRACT.md)
- [Docs/FILE-STRUCTURE.md](Docs/FILE-STRUCTURE.md)
