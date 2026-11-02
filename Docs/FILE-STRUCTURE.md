# File structure

<!-- Lives at /Docs/FILE-STRUCTURE.md. Whoever adds, moves or deletes a file or folder updates the tree in this file in the same commit. -->

Repo URL: `https://github.com/jgbotacc/onboarding-agent-v2` (private; v1 stays at `jgbotacc/onboarding-agent`)
Stack: `web (FastAPI + React/Vite, Neo4j Aura, Daytona, Vercel relay)`

## File tree
```
/
├── README.md                 how to run, build and test
├── requirements.txt          Python dependencies
├── Docs/
│   ├── PRD.md                v2 requirements, principles, integrations, API contract
│   ├── ASSUMPTIONS.md        decisions and assumptions log
│   ├── b2b-registration-form.html   field source of truth
│   ├── review-api.md         staff review API contract
│   ├── FILE-STRUCTURE.md     this file
│   └── flows/
│       ├── flows.md          user flow and data flow, step by step
│       ├── client-flow.png   client chat flow, with stand-out features
│       ├── staff-flow.png    staff review flow, with stand-out features
│       └── data-flow.png     data flow between browser, back end and services
├── src/
│   ├── app.py                FastAPI entry point (API + serves web/dist)
│   ├── features/
│   │   ├── chat/             onboarding state machine
│   │   ├── intake/           PDF/photo reading, ACRA parser, NRIC removal, validation
│   │   ├── i18n/             language detection and translation (Muse Spark)
│   │   ├── looks/            look briefs and 'Which look do you prefer?' rounds
│   │   ├── imagegen/         image providers (Muse, placeholder), 1080x1080 posts
│   │   └── staff/            staff review API, consult cards, metrics, email providers
│   ├── shared/               config, relay, Meta client, tracing, outbound guard
│   └── data/                 all database reads and writes (Neo4j, SQLite fallback)
├── db/migrations/            SQLite schema migrations
├── neo4j/                    graph schema, seed and queries (Cypher)
├── relay/                    Vercel pass-through to Neo4j, Muse and Resend
├── web/                      React + Vite front end (chat and /staff)
│   └── public/samples/       3 pre-made gallery posters, served at `/samples/`
├── screens/                  UI screenshots
├── tests/                    API, staff, relay and image tests
│   └── fixtures/             made-up ACRA-style fixture (no real data)
└── scripts/                  deploy, Cypher loader and sample-data scripts
```

## What each part is for
| Path | What lives here |
|------|-----------------|
| `/README.md` | How to run, build and test |
| `/Docs` | Form, API contract, flows and this file |
| `/Docs/flows` | `flows.md` (steps), `client-flow.png` and `staff-flow.png` (annotated storyboards), `data-flow.png` (services and endpoints) |
| `/src/features/<feature>` | One folder per feature; no cross-feature imports except via `/src/shared` |
| `/src/shared` | Config constants and the relay client |
| `/src/data` | DB access layer; features call it, never the DB directly |
| `/db/migrations` | Versioned SQLite schema changes |
| `/neo4j` | Constraints, seed and app queries for Aura |
| `/relay` | Standalone Vercel project; keys live only in Vercel env |
| `/web` | React front end; built to `web/dist` and served at `/`, `/staff`, `/review` |
| `/tests` | Pytest suites, including rollback cases |
| `/scripts` | Daytona deploy, sandbox exec, Cypher loader, sample PDF |

## Added files and folders
- `Docs/PRD.md`, `Docs/ASSUMPTIONS.md`: v2 requirements and decisions
- `src/shared/meta.py`, `src/shared/trace.py`, `src/shared/guard.py`: Meta client with retries, step tracing, outbound guard
- `src/features/intake/document.py`, `src/features/intake/photo.py`: general document and photo reading
- `src/features/i18n/`: language detection and translation
- `src/features/looks/`: look briefs and rounds
- `src/features/chat/consult.py`: consult card builder; `src/features/staff/metrics.py`: outcome and step metrics
- `db/migrations/006_v2.sql`: looks, consults, audit, traces, evals tables
- `scripts/make_acra_fixture.py`: builds the made-up ACRA-style fixture
- `tests/fixtures/`: fake ACRA-style profile (PDF and text)
- `Docs/UI-API-CONTRACT.md`: front-end view of the API
- `Docs/flows/flows.md`: user flow and data flow, step by step
- `Docs/flows/client-flow.png`: client chat flow storyboard, with stand-out features
- `Docs/flows/staff-flow.png`: staff review flow storyboard, with stand-out features
- `Docs/flows/data-flow.png`: data flow between browser, back end, relay, Neo4j, Muse and Resend
- `Docs/PITCH.md`: one-page pitch for the gallery-first branch
- `web/public/samples/`: 3 pre-made gallery posters, served at `/samples/`
- `tests/test_gallery.py`: gallery flow order tests
