# Onboarding Agent (v1)

AI-assisted onboarding chat for SaaS companies serving non-technical small businesses.
A client uploads a PDF with business details (and optional JPG reference images), the agent
registers them, asks for any missing mandatory fields, takes a design direction, and generates a
square (1080x1080) marketing mock-up. Up to 3 feedback rounds, then a human handoff.

## Layout
- `src/app.py` FastAPI app (API + serves `web/dist`, or `web/` plain HTML, or a stub)
- `src/features/intake` PDF parsing (pypdf) + regex extraction (LLM if `OPENAI_API_KEY`)
- `src/features/imagegen` providers: Gemini (`GEMINI_API_KEY`), OpenAI (`IMAGE_PROVIDER=openai`), else labelled PLACEHOLDER (Pillow)
- `src/features/chat` onboarding state machine
- `src/data` Neo4j store (`NEO4J_URI/NEO4J_USERNAME/NEO4J_PASSWORD`) or SQLite fallback (`var/`)
- `neo4j/` graph schema, seed and queries; `db/migrations` SQLite schema
- `scripts/deploy_daytona.py` deploy to a Daytona sandbox (`DAYTONA_API_KEY`)

## API
`POST /api/session`, `POST /api/upload` (multipart `sessionId`, `files[]`), `POST /api/chat {sessionId,text}`,
`POST /api/review {sessionId,accepted,feedback}`. All return `{reply, images, status, missing, round}`.
Security: `POST /api/session` returns `sessionSecret` once (also on a resume link); send it as the `x-session-secret` header (or `sessionSecret` field) on upload, form, chat and review, otherwise 403. Uploads accept only PDF (checked by `%PDF` bytes) and JPG/PNG (decoded and re-saved with Pillow), 10 MB a file. Set `DISABLE_DOCS=1` to hide /docs, /redoc and /openapi.json (the deploy script does).

## Run locally
```
pip install -r requirements.txt
uvicorn src.app:app --port 8000
pytest -q tests
```
Secrets only via env vars. Never commit `.env`.
