# File structure

<!-- Lives at /Docs/FILE-STRUCTURE.md. Whoever adds, moves or deletes a file or folder updates the tree in this file in the same commit. -->

Repo URL: `https://github.com/jgbotacc/onboarding-agent`
Stack: `web (FastAPI + React/Vite, Neo4j Aura, Daytona, Vercel relay)`

## File tree
```
/
├── README.md                 how to run, build and test
├── requirements.txt          Python dependencies
├── Docs/
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
│   │   ├── intake/           PDF parsing and field extraction
│   │   ├── imagegen/         image providers (Muse, placeholder), 1080x1080 posts
│   │   └── staff/            staff review API and email providers
│   ├── shared/               config and relay client
│   └── data/                 all database reads and writes (Neo4j, SQLite fallback)
├── db/migrations/            SQLite schema migrations
├── neo4j/                    graph schema, seed and queries (Cypher)
├── relay/                    Vercel pass-through to Neo4j, Muse and Resend
├── web/                      React + Vite front end (chat and /staff)
├── screens/                  UI screenshots
├── tests/                    API, staff, relay and image tests
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
- `Docs/flows/flows.md`: user flow and data flow, step by step
- `Docs/flows/client-flow.png`: client chat flow storyboard, with stand-out features
- `Docs/flows/staff-flow.png`: staff review flow storyboard, with stand-out features
- `Docs/flows/data-flow.png`: data flow between browser, back end, relay, Neo4j, Muse and Resend
