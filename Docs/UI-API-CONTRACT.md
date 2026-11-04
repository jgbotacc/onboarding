# UI ↔ API contract (v2 front end)

Owner: front end (`web/`). The UI talks to the backend only through the adapter in `web/src/api.ts`
(`realClient`). If backend names change, edit that one function. `?mock=1` runs the same contract
in the browser from `web/src/mock.ts` (client) and `web/src/staff/mock.ts` (staff).

All client paths are under `/api`, send `x-session-secret`, and include the language:
- JSON bodies carry `"lang": "en"|"zh"|"ms"|"ta"`; multipart uploads carry a `lang` form field.
- Every request also sends header `x-lang: <lang>` (same value), so GET/DELETE carry it too.
- The pick is stored in `localStorage["onboardingLang"]` (default `en`).

## Client routes

| Method / path | Body | Returns |
|---|---|---|
| `POST /api/session` | as v1 (`{}` / `{sessionId, sessionSecret}` / `{resumeToken}`) + `lang` | as v1 |
| `POST /api/chat` | `{sessionId, text, lang}` | ChatReply |
| `POST /api/form` | `{sessionId, fields, lang}` | ChatReply |
| `POST /api/upload` | multipart `sessionId`, `files[]`, `lang` | ChatReply (may hold `extracted` or `retake`) |
| `DELETE /api/upload` | `{sessionId, lang}` | ChatReply (pending document and its extracted fields removed) |
| `POST /api/extracted/confirm` | `{sessionId, fields: {key: value}, lang}` | ChatReply (saves the confirmed or edited fields) |
| `POST /api/looks/pick` | `{sessionId, picked_ids: [id], lang}` | ChatReply (`step: "accepted"`) |
| `POST /api/looks/skip` | `{sessionId, lang}` | ChatReply (next `looks` round, or `consult` after the 3rd skip) |
| `POST /api/review` | as v1 | ChatReply |
| `POST /api/trace` | `{sessionId, kind: "listen"\|"mic", ok: bool, ms: number, lang}` | anything; the UI ignores errors and never retries |

### ChatReply
```json
{
  "reply": "Short line one.\nShort line two.",
  "lang": "zh",
  "step": "registering|missing_info|confirm_details|choosing_look|accepted|handed_off|…",
  "status": "same as step (v1 name, optional)",
  "images": [], "missing": ["Business name"], "invalid": [], "round": 0,
  "looks":     { "round": 1, "max_rounds": 3, "options": [ { "id": "r1-a", "url": "https://…", "alt": "Warm, brown and cream" } ] },
  "extracted": [ { "field": "business_name", "label": "Business name", "value": "ABC Pte Ltd" } ],
  "retake":    { "reason": "blurry" },
  "consult":   { "status": "pending_approval", "submitted": { "Business name": "ABC Pte Ltd" }, "next_steps": ["Agree a style direction"] }
}
```
- `reply` is already in `lang`. `step` falls back to `status` if missing.
- `looks`, `extracted`, `retake`, `consult` are optional (absent or `null` = not shown).
- `looks.options` has 3 items. `alt` is a short description (used as image alt text, client's language).
- `extracted` never contains NRIC/FIN (no `nric` field, no NRIC-shaped values). The UI also hides any
  row whose field is `nric`/`fin` or whose value matches `[STFGM]\d{7}[A-Z]`.
- `retake.reason` is `"blurry"` or `"cropped"`; the UI shows a Retake button (camera capture on mobile).
- After the 3rd skip the reply has `consult` and the UI shows
  "Our team will arrange a consult with you to better understand what you like." (translated).

## Staff routes (English only, `x-staff-key`)

| Method / path | Returns |
|---|---|
| `GET /api/staff/consults` | `[{ id, client_id, business_name, status: "pending_approval"\|"approved", submitted: {label: value}, next_steps: [str], created }]` |
| `POST /api/staff/consults/{id}/approve` | the updated consult (`status: "approved"`, `approved_by`, `decided_at`) |
| `GET /api/staff/clients/{id}/rejected-looks` | `[{ round, options: [{id, url, alt}] }]` (every look not picked, grouped by round) |
| `GET /api/staff/clients/{id}` | v1 detail + optional `traces: [{step, model, ok, ms, cost_sgd, at}]` (the UI hides the table when absent) + `mismatch_flags: [{field, intake, document, source}]` (intake-vs-document differences after normalisation, derived at read time, staff only; absent or `[]` = none) + `documents: {docId: {filename, status, openable}}` (`status` reads `"file missing"` when the original is gone) |
| `GET /api/staff/clients/{cid}/documents/{docId}` | streams the kept original with its stored content type (needs `x-staff-key`; every open is audit-logged) |
| `GET /api/staff/metrics` | `{outcomes: {sessions, completed, completion_rate, avg_minutes_to_finish, avg_fields_needing_fixes, avg_rounds_to_pick, consult_rate}, steps: [{step, model, calls, ok_rate, avg_latency_ms, cost_sgd}], total_cost_sgd, errors?: [trace], evals?: {doc_extraction_accuracy, image_fit, n, at} \| null}` (PRD 3.1/3.5). Section hidden if the call fails |

## Mapping to PRD section 6
PRD names (`/api/looks {selected, skip}`, `/api/confirm {accept, edits}`, `DELETE /api/documents/{docId}`,
`/api/staff/consults/{id}/decision`, `confirm.fields[{key,label,value}]`, `looks.options[{id,url,title}]`,
`retake:true` + `retake_reason`) map one-to-one onto the names above. Staff paths live in one object (`real`) in `web/src/staff/api.ts`. The adapter in `api.ts`
also accepts those PRD response names (`confirm.fields`, `title`, `retake_reason`) so either backend shape renders.

## What the backend must provide (summary for Dev)
1. Accept `lang` (body field, multipart field, `x-lang` header) on every client route; reply text in that language.
2. ChatReply with `step` plus optional `looks`, `extracted`, `retake`, `consult` as above.
3. New client routes: `POST /api/looks/pick`, `POST /api/looks/skip`, `POST /api/extracted/confirm`, `DELETE /api/upload`, `POST /api/trace`.
4. Staff routes: `GET /api/staff/consults`, `POST /api/staff/consults/{id}/approve`, `GET /api/staff/clients/{id}/rejected-looks`,
   `GET /api/staff/metrics`, and `traces` on the client detail.
5. Staff data in English; never any NRIC/FIN in `extracted`, `consult.submitted` or traces.
