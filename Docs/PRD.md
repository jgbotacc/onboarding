# Onboarding Agent v2: product requirements

Status: in build (backend). Branch `v2`, repo `jgbotacc/onboarding-agent-v2` (private).
Related: `Docs/ASSUMPTIONS.md` (decisions and assumptions), `Docs/FILE-STRUCTURE.md`, `Docs/review-api.md` (v1 staff API, still valid).

## 1. Problem and users
The client is a **non-tech-savvy small business owner** finishing onboarding with us. They read very little,
may not write in English, and may only have a phone photo of their business registration.
Their main risks are **getting stuck** and **being misread**, so v2 prioritises plain language, short lines and
confirm steps over extra features.

Staff (our onboarding team) review every client in English, approve consult handoffs and emails, and see quality
and cost numbers.

## 2. Goals for v2
1. **General business document upload.** PDFs and phone photos (JPG, PNG, HEIC) of documents such as the ACRA
   business profile. We pull out business name, UEN, registered address, business type, industry (from business
   activity), director as contact and title. The client confirms what we found, then the bot asks only for what
   is still missing. The v1 registration-form PDF and the web form keep working unchanged.
2. **Four languages.** English, Chinese, Malay, Tamil. The client picks one or we detect it; the bot replies in it.
   Everything stored and shown to staff is English (the original text is kept too).
3. **"Which look do you prefer?"** Each round shows three graphics. The client picks one or more, or skips.
   Skip makes a new set, up to 3 rounds. Every rejected graphic is stored with its round number for staff.
4. **Consult handoff.** No pick after 3 rounds: the client is told (in their language) that our staff will arrange
   a consult to better find out their preferences. Staff get a consult card on the dashboard with everything
   already submitted and the unresolved next steps. **No email or other alert for consults.**

## 3. Principles
Each principle lists what we build to and how we check it.

### 3.1 Real problem, measured
- User: a non-tech-savvy business owner finishing onboarding.
- Success = form complete with few corrections, a look picked within 3 rounds, a low consult-handoff rate.
- **Outcome metrics** (computed from stored sessions, `GET /api/staff/metrics`):
  | Metric | Definition |
  |---|---|
  | `completion_rate` | sessions that reached a picked look (`accepted`) or staff decision / sessions with a business name |
  | `avg_minutes_to_finish` | first event to pick/accept, completed sessions only |
  | `avg_fields_needing_fixes` | distinct fields that were ever invalid or had to be asked again, per session |
  | `avg_rounds_to_pick` | look round in which the client picked, picked sessions only |
  | `consult_rate` | sessions handed off to a consult / sessions that saw at least one look round |

### 3.2 Full backend
- Real database with transactions: Neo4j (every write is a single Cypher statement, so one Query API request is one
  atomic transaction) with a durable SQLite fallback (each save/event runs in one SQLite transaction, rolled back on
  error). Rollback cases are tested.
- Staff-only access: every `/api/staff/*` route needs `x-staff-key` (fails closed). Client routes need the
  per-session secret.
- Logged errors: every failed model/tool call is logged (`logging`, logger `onboarding`) and traced with `ok=false`.
- Isolated concurrent sessions: a per-session lock serialises requests for the same session; different sessions
  never share state (tested with threads).
- Save-and-resume: state is saved after every step. A client returns with the same browser (session id + secret)
  or a private resume link from staff (no login).

### 3.3 Agent behaviour: one agent, clear steps
One agent (`src/features/chat/agent.py`) runs fixed steps, no agent stacking:
1. **Read document** (`intake/document.py`): text or photo in, candidate fields out. Read-only.
2. **Find gaps**: compare against the field list (mandatory first).
3. **Ask only missing**: one short line per field.
4. **Make image brief** (`looks/brief.py`): three look briefs from the confirmed fields, design direction and
   rejected looks.
5. **Generate** (`imagegen/providers.py`): Muse Image, one image per brief.
6. **Self-check**: image exists, is 1080x1080 and decodes; failed looks are regenerated once, then a labelled
   placeholder is used.
On a model call failure: retry with backoff (2 retries), then fall back to the non-AI path (regex reading,
English text, placeholder image) or ask the client a plain question. Never a dead end: every response has a next step.

### 3.4 Deliberate context
Each step gets only what it needs:
| Step | Sees | Never sees |
|---|---|---|
| Document reading | document text or photo + field list | chat history, other clients |
| Translation | the one message + target language | fields, history |
| Image brief | confirmed design fields + rejected look briefs | contact name, email, phone, documents |
| Image generation | the brief + reference images | anything else |
| Staff views | English record, original messages | NRIC (never stored) |

### 3.5 Trace everything
- Every step is logged as a trace: `{session_id, step, model, ok, latency_ms, cost_sgd, error, at}`.
- Cost in S$: Meta list price (USD) x `USD_SGD` (default 1.35). Muse Spark 1.3 standard: US$1.25 / 1M input,
  US$4.25 / 1M output tokens; Muse Image: US$0.01 per image.
- Jev scores (sampled, offline script `scripts/eval_sample.py`): document-extraction accuracy (fixture truth vs
  extracted) and image fit to brief. Cost is estimated before each run (Jev: US$0.042 / 1M input tokens).
  Scores are stored and shown in `GET /api/staff/metrics`.

### 3.6 Human in the loop
- **Autonomy ladder**
  | Action | Who decides |
  |---|---|
  | Read a document, ask questions, translate, make looks | automatic |
  | Save extracted client details | the client confirms first |
  | Send any email | staff (the decision click is the approval; a preview endpoint shows it first) |
  | Book the consult handoff | staff approve the consult card |
- **Read is separate from act**: extraction only reads. Extracted values are held as a pending draft that is not
  written to the client record, not shown to staff and not used for images until the client confirms.
- **Audit log** for every saved record, email and handoff, with who approved it (`client`, `staff:<name>`, `system`).
- **Outbound guard** (`shared/guard.py`): everything going to a client or staff (replies, staff views, emails) is
  checked so it never contains an NRIC/FIN or another client's email, UEN or phone. Matches are masked and logged.
- **NRIC never stored**: NRIC/FIN numbers are removed at extraction, before anything is held or saved.
- **Consent and deletion**: the client sees what was extracted from their document and can remove an uploaded
  file before anything is saved (`DELETE /api/documents/{docId}`).

### 3.7 Plain language
- Client replies are short lines, one idea per line (returned as `lines[]` so each can be read aloud).
- Per-field bullets stay ("I just need two fixes:" then one short line per field).
- Staff side is always English.

## 4. Integrations (pre-build integration checklist)

### 4.1 Integration inventory
| System | Capability / endpoint used | Docs | Owner |
|---|---|---|---|
| Meta Model API, Muse Spark 1.3 (`muse-spark-1.3`) | `POST https://api.meta.ai/v1/chat/completions` (text, image understanding, JSON output): fallback for document reading, photo reading and quality check, translation, look briefs | https://dev.meta.ai/docs/api-reference/chat-completions , https://dev.meta.ai/docs/pricing-rate-limits | Third party (Meta); key is Jin's |
| Baseten chat, Muse Spark (`meta-models/muse-spark-open-1026`) | OpenAI-compatible `POST https://inference.baseten.co/v1/chat/completions`: document reading, photo reading and quality check, translation, look briefs. The model always reasons and only `message.content` is read | https://docs.baseten.co | Third party (Baseten) |
| Meta Model API, Muse Image (`muse-image-1.0`) | `POST /v1/images/generations`, `POST /v1/images/edits` | https://dev.meta.ai/docs/api-reference/images | Third party (Meta) |
| Meta model list | `GET /v1/models` (checked 2026-11-03: muse-spark-1.1/1.2/1.3, muse-image-1.0, muse-wonder-1.0, ...) | https://dev.meta.ai/docs/api-reference/models | Third party |
| Neo4j Aura | HTTPS Query API `POST https://<host>/db/<db>/query/v2` (Bolt 7687 is blocked on the box) | https://neo4j.com/docs/query-api/current/ | Us (Jin's Aura) |
| SQLite | local file `var/onboarding.sqlite3` (fallback store, tests) | https://docs.python.org/3/library/sqlite3.html | Us |
| Resend | `POST https://api.resend.com/emails`, staff decision emails only (off-live unless `ONBOARDING_NOTIFY_EMAIL` and a key are set) | https://resend.com/docs/api-reference/emails/send-email | Third party |
| Vercel relay (v1) | pass-through to Neo4j, Muse images and Resend | `relay/README.md` | Us. **v2 does not deploy or change it.** |
| Jev (via Composio, `JEV_EVALUATE_STATE`) | offline sampled grading only; never called by the running app | Composio toolkit `jev` | Third party (TypeSafe AI), Jin's Composio account |
| Front end (`web/`) | consumes the API contract in section 6 | this doc | Teammate (front end) |

### 4.2 Source of truth
| Record | Owner | Derived copies |
|---|---|---|
| Field definitions | `Docs/b2b-registration-form.html` -> `src/shared/config.py` | SQLite `field_defs`, Neo4j `FieldDef` |
| Client session (fields, status, rounds, language) | the store (`sessions.state` / `Client.state`) | `field_values`, `Field` nodes, staff views |
| Pending extraction | session draft (`state.pending`) | none until confirmed |
| Uploaded files, generated images | `var/media` on the app host | URLs in state |
| Rejected looks, consult cards, audit, traces | the store (`looks`, `consults`, `audit`, `traces` tables / nodes) | staff API |
| Jev scores | the store (`evals`) | metrics API |

### 4.3 Data contract
- Meta chat request: `{model, messages:[{role, content:[{type:"text",text}|{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]}], response_format:{type:"json_object"}?, temperature}`;
  response `choices[0].message.content`, `usage.prompt_tokens`, `usage.completion_tokens`.
- Document reading output (JSON): `{business_name, uen, registered_address, business_type, industry, contact_name, title_position, email, phone_number, business_website}` all optional strings;
  photo reading adds `{readable: bool, problem: "blurry"|"cropped"|"unreadable"|null}`.
- Translation output: plain text, same number of lines.
- Look brief output (JSON): `{looks:[{title, style, palette, prompt}] x3}`.
- Muse Image: as v1 (`model, prompt, n:1, response_format:"b64_json", size:"1024x1024"`), resized to 1080x1080.
- Field mapping ACRA -> form: `Name` -> business_name, `UEN` -> uen, `Registered Office Address` -> registered_address,
  `Type` -> business_type, `Business Activity / Activity` -> industry (activity text without the SSIC code),
  first `Officers` row with Position Held = Director -> contact_name + title_position ("Director").
  `Identification No.` is dropped (NRIC). Records match on session id; UEN is stored but not a key.

### 4.4 Auth
| Connection | Auth | Secret location (names only) |
|---|---|---|
| Meta Model API | Bearer API key | env `MODEL_API_KEY` (box: `/home/box/.secrets/onboarding-app/meta.env`) |
| Baseten chat | Bearer key | env `BASETEN_API_KEY` (box secret in `/home/box/.secrets/onboarding-app/baseten.env`) |
| Neo4j | basic auth | env `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD` |
| Resend | Bearer API key | env `RESEND_API_KEY`; recipient `ONBOARDING_NOTIFY_EMAIL` |
| Staff routes | shared passcode | env `STAFF_PASSCODE`, header `x-staff-key`; optional `x-staff-name` for the audit log |
| Client routes | per-session secret (hash stored) | header `x-session-secret` |
| Jev | Composio connection | Composio account (not in the app) |

### 4.5 Failure plan
- Meta calls: timeout 60 s (vision 90 s), 2 retries with exponential backoff (1 s, 2 s) on 429/5xx/timeouts, then
  fall back: regex reading / English passthrough / placeholder image / ask the client. Every attempt is traced.
- Partial writes: one statement per Neo4j write (atomic), one transaction per SQLite save/event with rollback.
  Session state is written last for multi-part steps, and the pending draft keeps unconfirmed data out of records.
- Drift: `scripts/reconcile.py` (planned) compares `sessions.state` with `field_values` / Neo4j `Field` nodes and
  rewrites the derived copy from state (state wins). Traces with `ok=false` are listed in the metrics API.

### 4.6 Tool reality check (checked 2026-11-03)
- `GET /v1/models` with the key returned the models listed above; `muse-spark-1.3` and `muse-image-1.0` used.
- Muse Code CLI (`muse exec --provider meta`) runs on the same key; used to write code only.
- Jev via Composio exposes only `JEV_EVALUATE_STATE` and `JEV_LIST_MODELS` (text/JSON state, Noul/Choice/Score
  questions). It cannot see images, so image fit is graded from the brief plus a Muse Spark caption of the image.
- Neo4j Bolt is blocked on the box, so the HTTPS Query API is used (no multi-request transactions through the
  v1 relay; hence one-statement writes).
- HEIC needs `pillow-heif` (added to requirements); without it HEIC uploads get a "please send a JPG" reply.
- Gap: no server-side voice; Listen and the mic use the browser (front end).

### 4.7 Staff image studio

Feature: staff "image studio" panel per client in onboarding-agent-v2. Built on branch `staff-studio`.
Docs checked 2026-11-04.

---

#### 4.7.1 Integration inventory

| System | Endpoint / capability used | Checked against | Owner |
|---|---|---|---|
| Meta Muse Image `muse-image-1.0`, text to image | `POST https://api.meta.ai/v1/images/generations` (JSON: `model, prompt, n, size, response_format:"b64_json", output_format:"png"`, optional `reasoning_strength`, `tool_enablement`, `user`) | https://dev.meta.ai/docs/api-reference/images/create-image , https://dev.meta.ai/docs/image-generation ; repo `MuseProvider.generate` in `src/features/imagegen/providers.py` | Third party (Meta), Jin's key |
| Meta Muse Image, edit / remix / reference images | `POST https://api.meta.ai/v1/images/edits` (Meta JSON body: `images:[{image_url:"data:image/jpeg;base64,..."}]`, 1 to 10 items) | https://dev.meta.ai/docs/api-reference/images/edit-image ; repo already uses this for round 2+ and for reference photos | Third party (Meta) |
| Meta pricing and rate limits | Flat US$0.01 per returned image; `muse-image-1.0` 150 RPM per team; Muse Spark 1.3 standard US$1.25 in / US$0.15 cached / US$4.25 out per 1M | https://dev.meta.ai/docs/pricing-rate-limits | Third party |
| Vercel relay (v1, `relay/api/muse.js`) | `POST {RELAY_URL}/api/muse?op=generations|edits`. It passes the body through unchanged to `api.meta.ai/v1/images/<op>` (4.5 MB body limit, so images are downscaled with `_data_url`) | `relay/api/muse.js`, `src/shared/relay.py` | Us. **Not changed by this feature.** |
| Muse Spark `muse-spark-1.3` (optional) | `POST /v1/chat/completions`, only if we reuse `make_briefs` to get 2 alternative styles for drafts 2 and 3 | `src/shared/meta.py`, `src/features/looks/brief.py` | Third party |
| App store (SQLite live, Neo4j optional) | New `staff_drafts` table plus `Draft` node parity in `src/data/neo4j_store.py`; existing `audit`, `traces`, `looks`, `consults` | `db/migrations/*.sql`, `src/data/store.py`, `src/data/neo4j_store.py` | Us |
| Media storage | `var/media/*.png` on the app host (`MEDIA_DIR`) | `src/shared/config.py` | Us |
| Staff web (`web/src/staff/*`) and client picker (`web/src/looks/LooksPicker.tsx`) | New Studio panel; "Suggested by our team" label in the picker | repo | Us |
| Daytona sandbox `44729a7d` | Redeploy with `scripts/deploy_daytona.py` (it reuses the id in `.daytona_sandbox`, which isn't in the clone) | repo script | Us (Jin's Daytona) |

Not used: the Responses API (`/v1/responses` with `previous_response_id`). It keeps conversation state on Meta's side (`store` defaults to true), which we don't need and would add data retention. Remix uses single-shot `images/edits` with the source image attached, like the existing round 2+ flow.

#### 4.7.2 Source of truth

| Record | Owner | Derived copies |
|---|---|---|
| Client design fields used for the brief | the session (`sessions.state.fields`), filtered by `design_context` (the `ALLOWED` list) | studio prefill (read only, never written back) |
| Rejected looks | `looks` table (`selected=0`, older round, or every non-pick once the status is handed_off or accepted), via `_rejected()` in `src/features/staff/routes.py` | the `avoid` list in the studio prompt, remix sources |
| Staff drafts (prompt, author, preset, parent, status, pin, sent) | **new `staff_drafts` table** (Neo4j `Draft` node when live) | staff detail view, audit rows |
| Draft image bytes | `var/media/<uuid>.png` | URL in `staff_drafts.url` |
| Pin to consult | `staff_drafts.pinned_to` + `pinned_consult_id` | `consult.card.pinned_drafts` is rendered from `staff_drafts` at read time and **not stored in the card JSON**, so the two can't drift |
| Sent-to-client looks | `staff_drafts.sent_at`; the client sees it as a `looks` row with `round` = current round and `source='staff'` | the session's `looks` options in `out["looks"]` |
| Draft cap (9 per client) | count of `staff_drafts` rows with status in (`reserved`,`ok`) for the session | `remaining` in the studio GET |
| Spend | `traces` rows `step='studio_image'` (cost_sgd) + `/workspace/usage/meta-local-tally.md` for build-time calls | metrics API |
| Who acted | `audit` table (`actor = "staff:" + x-staff-name`) | staff audit view |

#### 4.7.3 Data contract

##### 4.7.3.1 New migration `db/migrations/007_staff_studio.sql`
```sql
CREATE TABLE IF NOT EXISTS staff_drafts (
  id TEXT PRIMARY KEY,               -- uuid hex, also the media file stem
  session_id TEXT NOT NULL,          -- client id (matches sessions.id)
  run_id TEXT NOT NULL,              -- one id per Generate/Remix click
  parent_id TEXT,                    -- draft id or look id this was remixed from
  parent_kind TEXT,                  -- 'draft' | 'look' | NULL
  preset TEXT NOT NULL,              -- 'post' | 'story' | 'flyer'
  width INTEGER NOT NULL, height INTEGER NOT NULL,
  marketer_prompt TEXT,              -- after guard scrub
  chips TEXT,                        -- JSON list of chip ids
  style_title TEXT, style TEXT,      -- variant used for this draft
  prompt TEXT,                       -- full prompt sent to Meta (scrubbed, no contact fields)
  url TEXT,                          -- /media/<id>.png, NULL until ok
  status TEXT NOT NULL,              -- 'reserved' | 'ok' | 'failed'
  error TEXT,
  author TEXT NOT NULL,              -- 'staff:<x-staff-name>'
  starred INTEGER NOT NULL DEFAULT 0,
  pinned_to TEXT,                    -- NULL | 'client' | 'consult'
  pinned_consult_id TEXT,
  sent_at TEXT, sent_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS staff_drafts_session ON staff_drafts(session_id, created_at);
ALTER TABLE looks ADD COLUMN source TEXT DEFAULT 'agent';   -- 'agent' | 'staff'
```
(SQLite `ALTER TABLE ADD COLUMN` isn't idempotent. Wrap it in a guarded migration step in `SqliteStore.__init__`, or put `source` in a side table. This is decided in M1.)

##### 4.7.3.2 Store methods (both `SqliteStore` and `Neo4jStore`)
`reserve_drafts(sid, n, cap, rows) -> list[id] | None` (atomic count and insert), `finish_draft(id, url|None, status, error)`, `drafts(sid)`, `get_draft(id)`, `set_draft_flags(id, starred?, pinned_to?, pinned_consult_id?)`, `mark_draft_sent(id, actor, at)`, `add_looks(..., source='staff')`.

##### 4.7.3.3 API routes (all on the existing staff router, so `require_staff` applies)
| Method and path | Body | Returns |
|---|---|---|
| `GET /api/staff/clients/{cid}/studio` | none | `{brief:{...design_context}, avoid:[{id,title,brief,url}], presets:[{id,label,w,h}], chips:[{id,label,text}], drafts:[Draft], cap:9, used:n, remaining:n}` |
| `POST /api/staff/clients/{cid}/studio/drafts` | `{marketer_prompt?: str<=500, chips?: [id], preset: 'post'|'story'|'flyer'}` | `{run_id, drafts:[Draft x3], remaining}`. 409 if fewer than 3 slots are left |
| `POST /api/staff/clients/{cid}/studio/remix` | `{source_id, source_kind:'draft'|'look', note?: str<=300, preset?}` | `{run_id, drafts:[Draft x1], remaining}` (409 at cap) |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/star` | `{starred: bool}` | Draft |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/pin` | `{target: 'client'|'consult'|null}` | Draft (409 `consult` when the client has no consult) |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/send` | `{}` | Draft with `sent_at` and the new client look id. 409 if already sent or the client can't receive it |

`Draft = {id, run_id, parent_id, parent_kind, preset, width, height, url, status, style_title, marketer_prompt, chips, author, starred, pinned_to, sent_at, created_at}`. The full `prompt` is returned only in the audit view.

Client side: the existing look option `{id,url,title}` gains `suggested: true` for staff-sent looks. The picker shows the label `looks.suggested` ("Suggested by our team", plus the zh/ms/ta strings).

##### 4.7.3.4 Meta request built by the studio
- Prompt = `build_prompt(dict(design_context(fields, direction, None), avoid=[rejected titles and briefs]))`, plus `Marketer direction: <scrubbed prompt>`, plus the chip texts, plus a size line ("Portrait 9:16 story", etc.), capped at 3,900 chars. The existing `build_prompt` ends with "Square 1:1...", so the studio needs a `build_prompt(..., shape=...)` parameter.
- 3 drafts per run: three calls with `n:1`, one per style variant. Variant 1 follows the brief and variants 2 and 3 come from `ALTERNATIVES` minus the rejected titles (no Spark call by default). Alternatively, one call with `n:3`. That's cheaper on latency but all 3 drafts come from one prompt, so there's less variety. **Default: 3 calls with `n:1`, run concurrently.**
- With the client's reference photos, or on remix: `images/edits` with up to 6 `image_url` data URLs. The remix source image goes first.
- `tool_enablement: {enable_web_search:false, enable_shell:false}` and `reasoning_strength:"low"` are recommended (faster, and no web lookups on a client's name). This needs a live check.
- Contact fields (`contact_name, email, phone_number, title_position, business_website, expected_annual_revenue, uen, registered_address`) are never in the prompt. Enforcement: `design_context` `ALLOWED` plus `guard.clean` on the marketer text with the client's **own** email, phone and UEN added to the mask set, plus `scrub_nric`, plus a test that asserts none of those values appear in the outgoing body.

#### 4.7.4 Auth and secrets (names only)

| Connection | Auth | Where (env var names) |
|---|---|---|
| Meta images (direct) | Bearer [REDACTED] key | `MODEL_API_KEY` (box: `/home/box/.secrets/onboarding-app/meta.env`). Optional `META_API_BASE`, `MUSE_MODEL`, `IMAGE_PROVIDER` |
| Meta images (via relay) | shared secret header `x-relay-secret`; the relay holds `MODEL_API_KEY` | `RELAY_URL`, `RELAY_SECRET` |
| Staff studio routes | shared passcode header `x-staff-key`; author from optional `x-staff-name` (self-reported, not proof) | `STAFF_PASSCODE` |
| Client picker (sent drafts) | per-session secret `x-session-secret` (hash stored) | none (runtime) |
| Daytona redeploy | API key | `DAYTONA_API_KEY`; sandbox id file `.daytona_sandbox` |
| Muse Code (build time only) | `muse exec --provider meta --model muse-spark-1.3 --contributor-mode off`, using `MODEL_API_KEY` | env only |
| Tests | none; `MODEL_API_KEY`, `RELAY_*` unset, httpx mocked (A24) | n/a |

#### 4.7.5 Failure plan

- **Retries:** add a small retry wrapper to the studio's image call: 2 retries on 429, 503, timeouts and transport errors, with exponential backoff (0.5 s, then 1 s, plus jitter) that honours `Retry-After`. No retry on 400 (`content_policy_violation`, bad size) or other 4xx. Timeouts are 180 s direct and 90 s via the relay (as now). Every attempt is traced as `studio_image`.
- **No silent placeholder:** unlike client rounds, a failed studio draft is marked `failed` with a short error and shown as a failed tile. It does **not** fall back to a Pillow placeholder, so marketers never mistake a placeholder for a real draft. Failed drafts don't count toward the cap, and Meta doesn't bill failed or filtered images.
- **Cap atomicity (9 per client):** `reserve_drafts` runs in one locked SQLite transaction: `SELECT COUNT(*) WHERE session_id=? AND status IN ('reserved','ok')`, and if `count + n <= 9` it inserts `n` `reserved` rows, otherwise it returns None and the route returns 409. Meta is called only after the reservation commits. Each call then moves its row to `ok` or `failed`. In Neo4j, one Cypher statement does the conditional create (`MATCH ... WITH count(d) AS c WHERE c + $n <= 9 UNWIND ... CREATE`). The per-session `_lock_for(sid)` in `app.py` should also wrap the run, so two marketers can't race.
- **Partial writes:** the image file is written before the row moves to `ok`. If the process dies, the row stays `reserved`. The audit row (`studio_draft`) is written after `ok` or `failed`. Send-to-client happens in one transaction (insert the `looks` row with `source='staff'` and set `sent_at`), then the session state, then the audit row.
- **Reconciliation:** on studio GET (and in `scripts/reconcile.py`), `reserved` rows older than 10 minutes become `failed` ("timed out"), which frees their slots. `ok` rows whose media file is missing are flagged `failed` ("file missing"). Sent drafts with no matching `looks` row are listed in the metrics API as drift.
- **Contact-name leak (found by the 2026-11-04 smoke test):** a partial contact name in the marketer text reached the prompt. Fixed by masking each name part, whole words only, which can also mask an ordinary word equal to a name part.
- **Spend guard:** each successful image is traced with `cost_sgd = usd_to_sgd(0.01)`. Stop if the team's high estimate reaches S$115.

#### 4.7.6 Tool reality check (from docs and code only; nothing was called)

Confirmed from docs:
- `n` is 1 to 10, and a request returning `n` images is billed for `n` images at a flat US$0.01 each, whatever `reasoning_strength` or tool use.
- `size` is a `"WxH"` string that **sets the aspect ratio only**. The returned pixels won't match, and anything beyond 16:1 returns 400. The repo notes back this up: "Muse returns ~1600x1600 regardless of size".
- `output_format` can be `webp` (default), `png` or `jpeg`; the repo sends `png`. `response_format` can be `b64_json` or `url`.
- `images/edits` accepts 1 to 10 images, given as `image_url` data URLs or `file_id`s, so remixing from a draft or a rejected look (all local files) works the same way the repo does round 2+ now.
- `tool_enablement`, `reasoning_strength` and `user` are top-level fields on the images endpoints. Unknown top-level fields (for example `seed`) return 400, and `moderation` returns 400 on `muse-image-1.0`.
- Errors: 503 retryable, 500 not classified, 400 `content_policy_violation`.

Gaps and workarounds:
- **Exact sizes aren't guaranteed.** Send the aspect-ratio hint (`1024x1024`, `1080x1920`, `1240x1754`), then post-process to the exact preset with a new `to_size(url, (w,h))` that uses `ImageOps.fit` (centre crop, no stretching). Use pad mode if the hint wasn't honoured and the crop would cut more than 15% of the image. Presets: post 1080x1080, story 1080x1920, flyer 1240x1754 (A5 portrait at 150 dpi, ratio 1:√2; open to change). Today's `to_post_size` stretches to square with `resize`. Keep it for client rounds and don't use it for the studio.
- **No seed or variation endpoint**, so "more like this" = `images/edits` with the source image plus "Make a close variation of this design; keep layout and colours" plus the optional note.
- **There's no negative-prompt field**, so steering away from rejected looks is prompt text only (the existing `avoid` line). It's best effort, not a guarantee.
- **The images endpoints don't return a `reasoning` item** (docs), so there's nothing to show marketers about what the model did.
- **The relay's 4.5 MB body limit**: keep `_data_url(max_side=1024)` and at most 6 images (already in place).
- **No server-side spend cap from Meta.** The 9-draft cap and traces are our only controls.

**Live check (2026-11-04):** direct path (no relay), muse-image-1.0. One run of 3 square drafts took 14 s with the calls in parallel (single calls 9.6 to 13.3 s). A story remix and a flyer remix of a rejected look both returned 200. All outputs were exact preset sizes after to_size, with no pad bands, so the aspect hint looks honoured; native pixel sizes were not recorded. reasoning_strength low and tool_enablement were accepted on generations and edits. Relay path not tested live.

#### 4.7.7 Decisions on earlier open questions
- Live size check: non-square `size` and `tool_enablement` / `reasoning_strength` on `muse-image-1.0` are confirmed by one paid smoke test per preset (recorded in the README once done).
- Config path: the studio uses the same path as `MuseProvider` (relay when `RELAY_URL` and `RELAY_SECRET` are set, else direct with `MODEL_API_KEY`).
- Sent drafts: a sent draft is added to the client's session as a look labelled "Suggested by our team". If the client is already handed off or approved it still appears in their session and is also attached to the consult card.
- Remix makes 1 draft.
- Flyer preset = A5 portrait 1240x1754.
- Neo4j parity is unit-tested with a fake, not run against Aura (as A23). Accepted.
- Author identity is the self-reported `x-staff-name`. Accepted until per-staff logins exist.
- Client picker polls every 15 s while open so sent suggestions appear; a suggestion sent during a round is replaced when the client skips to the next round.

### 4.8 Client feedback and share links

Feature: the client hearts or rejects studio drafts, and staff send a no-login share link where
the client approves a draft or asks for changes. Tracking card: Jira KAN-18. Built 2026-11-04
(backend only: migration 008, both stores, staff + public routes; no web UI yet).
Docs checked 2026-11-04.

Design decisions (fixed here so build has no open questions):
- Hearts and rejections join the same steer-away-from-rejected-looks path the studio already uses:
  `studio_prompt` builds its `avoid` list with `_avoid_list`, and `variants` drops rejected titles
  (`src/features/imagegen/studio.py`). Client feedback rows are mapped to that `{title, brief/style}`
  shape, so the next brief treats a rejected draft exactly like a rejected look. No new prompt logic.
- A heart also adds the draft to the shortlist. Unhearting (or staff removal) takes it off.
- Share tokens live 7 days by default, are scoped to one client, and resolve the visible drafts live
  from `staff_drafts` rows with `sent_at` set. Nothing is frozen into the link, so sending another
  draft updates what the same link shows. Revoke ends a link at once.
- Drafts stay staff-only until sent: the public link never lists unsent drafts, and guessing a draft
  id returns 404.
- Approval picks one shortlisted draft; a change request must include a short note (max 500 chars,
  guard-scrubbed). Both are audit-logged like staff actions.

---

#### 4.8.1 Integration inventory

| System | Capability / endpoint used | Checked against | Owner |
|---|---|---|---|
| App store (SQLite live, Neo4j optional) | New `draft_feedback`, `shortlist`, `share_tokens` tables plus `ShareToken` / feedback node parity in `src/data/neo4j_store.py`; existing `audit`, `staff_drafts`, `looks` | `db/migrations/*.sql`, `src/data/store.py`, `src/data/neo4j_store.py` | Us |
| Studio prompt builder | `studio_prompt(..., rejected=feedback_as_rejected)` reuses `_avoid_list` and `variants`; no new steer-away code | `src/features/imagegen/studio.py`, `src/features/looks/brief.py` (`make_briefs`, `design_context`) | Us |
| Outbound guard | `guard.clean` scrubs client change-request notes with the client's own identifiers before staff see them | `src/shared/guard.py`, `src/shared/security.py` | Us |
| Staff web (`web/src/staff/*`) | Send-link button, shortlist view, feedback feed; new strings follow the existing i18n check scripts | repo `web/scripts/test-i18n.mjs` | Us |
| Public share page (new, no login) | Opens `{base}/share#t=<token>` (token in the fragment, never sent to the server); reads the public header-based share contract below; polls every 15 s like the client picker while open | this doc | Us |
| Vercel relay (v1) | Not used. No Meta call is needed for this feature | `relay/README.md` | Us. **Not changed by this feature.** |
| Daytona sandbox | No redeploy in this work; hosting stays on the existing sandbox | repo script `scripts/deploy_daytona.py` | Us |

#### 4.8.2 Source of truth

| Record | Owner | Derived copies |
|---|---|---|
| Feedback (heart / reject / approve / change request, with note) | **new `draft_feedback` table** (Neo4j `Feedback` node when live) | the `rejected` list fed to `studio_prompt` / `make_briefs`; staff feedback feed |
| Shortlist | **new `shortlist` table** (Neo4j `SHORTLISTED` edge draft -> session when live); a heart inserts, an unheart or staff removal deletes | staff shortlist view, share page "liked" flags |
| Share token | **new `share_tokens` table** (Neo4j `ShareToken` node when live); only the SHA-256 hash is stored, never the token | the one-time link shown to staff; expiry/revoke checks at read time |
| Audit entry | existing `audit` table (`actor = "client:share"` for link actions, `"staff:" + x-staff-name` for sends/revokes) | staff audit view (`GET /api/staff/audit?client=<id>`) |
| Visible set on a link | resolved live: `staff_drafts` rows with `sent_at` set, for the token's session | nothing stored on the token, so send/revoke take effect at once |

#### 4.8.3 Data contract

##### 4.8.3.1 New migration `db/migrations/008_client_feedback.sql`
```sql
CREATE TABLE IF NOT EXISTS draft_feedback (
  id TEXT PRIMARY KEY,                 -- uuid hex
  session_id TEXT NOT NULL,            -- client id (matches sessions.id)
  draft_id TEXT NOT NULL,              -- staff_drafts.id (sent drafts only)
  kind TEXT NOT NULL,                  -- 'heart' | 'reject' | 'approve' | 'changes'
  note TEXT,                           -- change-request text, guard-scrubbed; NULL otherwise
  actor TEXT NOT NULL,                 -- 'client:share' | 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS feedback_session ON draft_feedback(session_id, created_at);
CREATE TABLE IF NOT EXISTS shortlist (
  session_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  added_by TEXT NOT NULL,              -- 'client:share' | 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id, draft_id)
);
CREATE TABLE IF NOT EXISTS share_tokens (
  id TEXT PRIMARY KEY,                 -- uuid hex, used in audit details (never the token)
  session_id TEXT NOT NULL,            -- the one client this link opens
  token_hash TEXT NOT NULL UNIQUE,     -- SHA-256 of the token (same helper as session secrets)
  created_by TEXT NOT NULL,            -- 'staff:<x-staff-name>'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,            -- created + 7 days by default
  revoked_at TEXT,                     -- set on revoke; NULL while live
  used_at TEXT                         -- first successful public read (info only)
);
CREATE INDEX IF NOT EXISTS share_tokens_session ON share_tokens(session_id, created_at);
```

##### 4.8.3.2 Store methods (both `SqliteStore` and `Neo4jStore`)
`record_feedback(sid, draft_id, kind, note, actor) -> row` (validates kind and that the draft is
sent for this session; a `heart` also inserts the shortlist row, a `reject` also removes it),
`feedback_for(sid)`, `shortlist_add(sid, draft_id, actor)`, `shortlist_remove(sid, draft_id)`,
`shortlist_for(sid)`, `issue_share_token(sid, actor, days=7) -> (id, token)` (one transaction:
insert hash row, audit `share_issued`; the plaintext token is returned once and never stored),
`find_share_token(token) -> row | None` (hash, then check session, expiry and `revoked_at`),
`revoke_share_token(id, actor)`, `mark_share_used(id, at)` (first successful public read),
`shares_for(sid)` (staff list: id, expiry and status only, never hashes or tokens),
`sweep_expired_tokens() -> int` (deletes rows past expiry).

##### 4.8.3.3 API routes
Staff (existing staff router, so `require_staff` applies):

| Method and path | Body | Returns |
|---|---|---|
| `POST /api/staff/clients/{cid}/studio/share` | `{days?: int 1..30, default 7}` | `{id, url, expires_at}`. The `url` is `{base}/share#t=<token>` (token in the fragment, never sent to the server) and is shown once |
| `GET /api/staff/clients/{cid}/studio/shares` | none | `[{id, expires_at, revoked_at, used_at, created_by}]` (no hashes, no tokens) |
| `POST /api/staff/clients/{cid}/studio/shares/{tid}/revoke` | `{}` | `{id, revoked_at}` |
| `GET /api/staff/clients/{cid}/studio/shortlist` | none | `{drafts:[Draft], feedback:[{draft_id, kind, note, actor, created_at}]}` |
| `POST /api/staff/clients/{cid}/studio/shortlist/{did}` | `{add: bool}` | `{drafts:[Draft]}` |

Public (no login; the token is the only secret, sent in the `x-share-token` header —
never in the path or query string, so server access logs cannot record it):

| Method and path | Headers | Body | Returns |
|---|---|---|---|
| `GET /api/share` | `x-share-token` | none | `{business_name, drafts:[{id, url, title, liked: bool}], shortlist:[id], decided: null \| {draft_id, kind}}`. 404 for unknown/revoked/missing, 410 for expired |
| `POST /api/share/feedback` | `x-share-token` | `{draft_id, kind: 'heart' \| 'reject' \| 'approve' \| 'changes', note?: str<=500}` | `{ok:true, shortlist:[id]}`. `note` is required for `changes` and ignored for other kinds |

`approve` records the final pick and marks the draft's `looks` row selected, like a client pick
(when the client's session is still awaiting review and holds the look, the session is marked
accepted too). `changes` appends the scrubbed note to the feedback feed for the next brief round.
`decided` on the share GET is the latest `approve`, else the latest `changes`, else null.

#### 4.8.4 Auth and secrets (names only)

| Connection | Auth | Where (env var names) |
|---|---|---|
| Staff share routes | shared passcode header `x-staff-key`; author from optional `x-staff-name` (self-reported, not proof) | `STAFF_PASSCODE` |
| Share link | unguessable token (`secrets.token_urlsafe(32)`); only its SHA-256 hash is stored, compared with `hmac.compare_digest`; sent by the client in the `x-share-token` header, carried in the share page URL fragment (`/share#t=<token>`, never sent to the server); logged or shown nowhere except the one-time staff response | none (runtime) |
| Client picker / session routes | unchanged: per-session secret `x-session-secret` (hash stored) | none (runtime) |
| Tests | none; model and relay keys unset, httpx mocked | n/a |

#### 4.8.5 Failure plan

- **Retries:** feedback and token writes are local store writes, so no network retry is needed;
  this feature makes no Meta calls. Brief regeneration after feedback reuses the studio retry
  wrapper (2 retries on 429/503/timeouts, traced as `studio_image`).
- **Partial writes:** `record_feedback` runs in one transaction (feedback row plus shortlist
  insert/delete, then the audit row). `issue_share_token` runs in one transaction (token row plus
  audit row); the plaintext token is returned only after the commit. In Neo4j each is one Cypher
  statement, so one atomic Query API request. The per-session lock in `app.py` wraps public
  feedback writes, so two taps on one link cannot double-insert (shortlist insert is idempotent).
- **Reconciliation:** `sweep_expired_tokens` runs on share GET (after the token resolves, so an
  expired link still reads 410 on that request) and in `scripts/reconcile.py`. The metrics API
  lists a `drift` array: sent drafts with a missing media file or no matching `looks` row,
  feedback rows pointing at deleted drafts, and shortlist rows for unsent drafts.
  Feedback rows pointing at deleted drafts, and shortlist rows for unsent drafts, are listed in the
  metrics API as drift (same pattern as sent-draft drift in 4.7.5) rather than silently dropped.
  Expired tokens read as 410 ("this link has expired, ask our team for a new one"); revoked or
  unknown tokens read as 404, so a revoked link is indistinguishable from a made-up one.
- **Abuse guard:** public feedback is rate-limited per token (30 writes per hour; 429 over that),
  and notes pass `guard.clean` before staff see them.
- **Log safety:** the token never appears in a URL path or query string — the public API
  reads it from the `x-share-token` header and the share page link keeps it in the URL
  fragment (`/share#t=<token>`), which browsers never send. Only the SHA-256 hash is
  stored, and audit rows hold the link id, never the token or hash. As a second layer,
  `src/shared/redact.py` installs a logging filter on the app and uvicorn loggers
  (access log included) that rewrites any residual `/share/<token>` or `token=` value
  before it is emitted. Error messages stay generic (unknown/revoked read 404, expired
  reads 410) and never echo the token. A test drives the share routes and asserts the
  plaintext token appears in no captured log record, trace or audit row.

#### 4.8.6 Tool reality check (actually run, 2026-11-04)

- `NEO4J_*` unset, so the app falls back to SQLite: import of `src.app` prints
  `[data] NEO4J_* env not set; FALLING BACK to SQLite at /workspace/ob-v2-feedback/var/onboarding.sqlite3`.
- Route list from the staff router (`make_router` in `src/features/staff/routes.py`): 25 paths
  including `/api/clients` and `/api/admin` aliases — staff clients, decisions, consults, the six
  studio endpoints from 4.7, metrics, traces and audit. No share routes exist yet (this section
  designs them). App-level client routes (`src/app.py`) are unchanged: session, upload, chat,
  confirm, looks, review, resume, language, trace.
- Migrations on disk: `db/migrations/001_init.sql` through `007_staff_studio.sql`. `008` is new here.
- `env -u MODEL_API_KEY -u META_API_KEY -u RELAY_URL -u RELAY_SECRET python -m pytest -q tests`:
  **219 passed** in about 14 s.
- `npm --prefix web test`: all 7 check scripts pass (validation 87, i18n 463, api-contract 59,
  mock-contract 27, consult-text-only 4, looks-refresh 13, studio-mock 12).
- Relay status not re-probed this round (taken as given: Vercel relay paused, HTTP 503
  `DEPLOYMENT_PAUSED`); no Meta call was made or needed for this feature.

### 4.9 Staff case view

Feature: clicking a client in the staff list opens a case view (timeline of stages, step cards with a side
panel, case file panel). Branch `staff-case-view`. Frontend only; no new backend, no new auth.

#### 4.9.1 Integration inventory (six points)

| # | System / input | New? |
|---|---|---|
| 1 | Staff client detail `GET /api/staff/clients/{id}` — `audit`, `traces`, `documents`, `looks`, `consult`, `transcript`, `decisions`, `outbox` | None new; already returned |
| 2 | Studio drafts `GET /api/staff/clients/{id}/studio` — drafts shown in the case file | None new; existing route |
| 3 | Staff auth (`x-staff-key`, existing `require_staff`) | None new |
| 4 | Masking (`guard.clean` server-side; client-side NRIC-pattern mask as belt-and-braces) | None new |
| 5 | Mock data (`?mock=1` staff mock: transcript, audit, documents, looks, consult) | Extended the mock only |
| 6 | Stage/step derivation (`web/src/staff/caseView.ts`, pure function of the detail payload) | New, frontend only |

Stages shown are the six that exist on main (intake chat, document and photo reading, brand brief, image
drafts, client approval, done). No brand board or share link stage. Actor names are rendered as roles
(Staff / Client / System); no team names.

## 5. Flows (backend)
```
upload (PDF or photo) -> read (regex for the registration form; ACRA parser + Muse Spark for other documents)
  photo unreadable -> retake (status unchanged, retake=true)
  registration-form PDF -> fields saved as in v1
  other document -> status confirm_details (pending draft) -> client confirms / edits / removes file
missing fields -> ask only those -> design direction -> look round 1..3 (3 looks each)
  pick one or more -> accepted
  skip -> rejected looks stored -> next round; after round 3 -> handed_off + consult card (pending_approval)
staff: approve consult card; decisions and emails as v1, all audited
```

## 6. API contract for the front end
All client routes need `x-session-secret` (or `sessionSecret` in the body). Every client response has the v1 shape
plus the new fields:
```
{ reply, lines: [str], lang: "en"|"zh"|"ms"|"ta", images, status, missing, invalid, round,
  retake: bool,                      // true = photo unreadable, ask for a retake; nothing changed
  retake_reason: "blurry"|"cropped"|"unreadable"|null,
  confirm: null | { docId, filename, fields: [{key, label, value}], removed: ["nric"] },
  looks: null | { round, max_rounds: 3, prompt: "Which look do you prefer?", options: [{id, url, title}] },
  consult: null | { id, status } }
```
`reply`/`lines` are in the client's language. `missing`/labels stay English keys' labels (UI translates labels).
New statuses: `confirm_details`.

### Client routes
| Method / path | Body | Result |
|---|---|---|
| `POST /api/language` | `{sessionId, lang}` (`en`, `zh`, `ms`, `ta`) | response re-sent in that language; later replies use it |
| `POST /api/upload` | multipart `sessionId`, `files[]`, optional `purpose` = `document` or `reference` | PDFs are documents; images are references unless `purpose=document`. Photos of documents may return `retake:true` |
| `POST /api/confirm` | `{sessionId, accept: bool, edits?: {key: value}, remove?: [key]}` | `accept:true` saves the draft (with edits, without removed keys) and asks for what is missing; `accept:false` discards it |
| `DELETE /api/documents/{docId}` | header secret; query or body `sessionId` | removes a pending uploaded document and its draft; 409 once confirmed |
| `POST /api/looks` | `{sessionId, selected: [lookId], skip?: bool}` | pick one or more -> `accepted`; `skip:true` (or empty `selected`) -> next round or consult |
| `POST /api/chat` | as v1 | also understands "yes"/"no" in `confirm_details`, "1 and 3"/"skip" during looks; any language |
| `POST /api/review` | as v1 | still works: `accepted:true` picks look 1; feedback makes the next round use it |

### Staff routes (`x-staff-key`; optional `x-staff-name` recorded in the audit log)
| Method / path | Result |
|---|---|
| `GET /api/staff/clients/{id}` | v1 detail plus `lang`, `transcript: [{role, text, original, lang, at}]`, `looks: [{round, id, url, title, brief, selected: bool}]`, `rejected_looks` (same items, not selected), `consult`, `audit` |
| `GET /api/staff/clients/{id}/rejected-looks` | grouped by round: `[{round, options: [{id, url, alt, title, brief, at}]}]` |
| `GET /api/staff/consults` | consult cards, newest first: `{id, client_id, business_name, status: "pending_approval"\|"approved"\|"declined", created, lang, submitted: {label: value}, next_steps: [str], rejected_rounds, rejected_looks: [...], approved_by, decided_at, note}` |
| `POST /api/staff/consults/{id}/decision` | `{decision: "approve"\|"decline", note?}` -> updated card (audited; no email) |
| `POST /api/staff/clients/{id}/decision/preview` | same body as decision -> `{subject, body}`; nothing sent |
| `GET /api/staff/metrics` | `{outcomes: {sessions, completed, completion_rate, avg_minutes_to_finish, avg_fields_needing_fixes, avg_rounds_to_pick, consult_rate}, steps: [{step, model, calls, ok_rate, avg_latency_ms, cost_sgd}], total_cost_sgd, errors: [recent failed traces], evals: {doc_extraction_accuracy, image_fit, n, at} \| null}` |
| `GET /api/staff/traces?client=<id>&limit=100` | traces newest first |
| `GET /api/staff/audit?client=<id>` | audit entries `{at, actor, action, target, client_id, details}` |
| `GET /api/staff/clients/{cid}/studio` | `{brief, avoid, presets, chips, drafts, cap: 9, used, remaining}` |
| `POST /api/staff/clients/{cid}/studio/drafts` | `{marketer_prompt?, chips?, preset}` -> `{run_id, drafts x3, remaining}`; 409 if fewer than 3 slots left |
| `POST /api/staff/clients/{cid}/studio/remix` | `{source_id, source_kind, note?, preset?}` -> `{run_id, drafts x1, remaining}`; 409 at cap |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/star` | `{starred: bool}` -> Draft |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/pin` | `{target: 'client'\|'consult'\|null}` -> Draft; 409 `consult` with no consult |
| `POST /api/staff/clients/{cid}/studio/drafts/{did}/send` | `{}` -> Draft with `sent_at` and new client look id; 409 if already sent or client can't receive it |

### Front-end route names (aliases, see `Docs/UI-API-CONTRACT.md`)
`POST /api/looks/pick {picked_ids}`, `POST /api/looks/skip`, `POST /api/extracted/confirm {fields}`, `DELETE /api/upload`,
`POST /api/trace {kind: "listen"|"mic", ok, ms}`, `POST /api/staff/consults/{id}/approve`. Every client route also takes
`lang` (body or multipart field) or the `x-lang` header. Replies add `step` (= status), `extracted` (= `confirm.fields` as
`{field, label, value}`) and `alt` on look options. Staff client detail adds `traces: [{step, model, ok, ms, cost_sgd, at}]`.

### Quality numbers
Jev sample on the smoke test (2026-11-03): document extraction from a phone photo of the made-up ACRA fixture 2.93/3,
image fit to brief 2.68/3 (from short descriptions of the three looks). Not yet imported into the store; `scripts/eval_sample.py`
is planned, so `evals` in the metrics API is `null` for now.

## 7. Out of scope for v2 backend
Redeploying Daytona/Vercel, changing the v1 repo, server-side voice, consult emails or alerts.
