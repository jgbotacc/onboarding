# Staff review API

Page: `/staff` (served by the SPA). Every staff API call needs the `x-staff-key` header matching the `STAFF_PASSCODE` env var (401 if wrong, 503 if the server has none set). The page asks for the passcode and keeps it in sessionStorage. List and detail responses never include email bodies or resume links; the decision response returns `resume_url` once.

## GET /api/staff/clients
Registered clients, newest first. Each row:
`{id, business_name, industry, contact_name, email, status, round, image, updated}`
(`image` = latest generated image URL, `updated` = ISO timestamp UTC).

## GET /api/staff/clients/:id
`{id, business_name, industry, contact_name, email, status, round, image, updated,
  fields, labels, images, reference_images, rounds, decisions, outbox, refill, missing}`
- `fields`: all form keys -> values; `labels`: key -> display label
- `images`: latest round's image URLs; `reference_images`: uploaded reference image URLs
- `rounds`: `[{round, images, direction, feedback, accepted}]`
- `decisions`: `[{id, decision, fields, note, at, previous_status}]`
- `outbox`: `[{to, subject, body, sent_at, status, provider}]`
- `refill`: field keys still requested from the client; `missing`: their labels

## POST /api/staff/clients/:id/decision
Body: `{decision: "approve" | "reject" | "more_info", fields: [keys], note}`
- approve -> status `approved`, email: "Our operations team will get in contact with you soon."
- reject -> status `rejected`, polite rejection email
- more_info -> status `needs_info`; needs `fields` and/or `note`; email lists the fields + note +
  `{PUBLIC_BASE_URL}/?resume=<token>`
Returns the client detail plus `email` (the sent message) and `resume_url` (more_info only).
400 on unknown field keys or an empty more_info; nothing is changed in that case.

Every email goes to the one address in the `ONBOARDING_NOTIFY_EMAIL` env var; the client's own
email appears in the body as "Client email on file: ...". Provider: Resend when `RESEND_API_KEY`
is set, otherwise the outbox (status "Sent (demo)"). If `ONBOARDING_NOTIFY_EMAIL` is unset, nothing is
sent and the message is kept in the outbox with status "Not sent (demo), ONBOARDING_NOTIFY_EMAIL not set".

## Resume
`POST /api/session {resumeToken}` -> the client's session in the usual response shape
`{sessionId, reply, images, status, missing, round}`, with `missing` = only the requested fields.
The chat then asks only for those. When all are filled, status becomes `pending_review`
(a new image round runs only if design_preferences / requirements_notes changed).

Statuses: need_document, missing_info, need_direction, awaiting_review, accepted, handed_off,
approved, rejected, needs_info, pending_review.

## Front end (web/src/staff/*)

Routes: `/#/staff` (primary) and `/#/review` (alias). The page also renders when the backend serves
index.html at the paths `/staff`, `/review`, `/admin` (top level only; nested paths like `/staff/x`
break relative asset URLs because the build uses base `./`).

Calls the front end makes:
- `GET /api/staff/clients` on load. Uses `id, business_name, contact_name, email, status, round,
  image` (row thumbnail), `updated` (date shown). Any failure, or `?mock=1`, switches to demo data
  (badge "Demo mode (mock data)").
- `GET /api/staff/clients/:id` when a row is expanded. Uses `fields` (the 11 form keys), `images`,
  `reference_images`, `round`, `status`, `outbox` (last entry shown as "Last Email: ...").
- `POST /api/staff/clients/:id/decision` `{decision, fields, note}` after the confirm step
  (approve/reject) or the field picker (more_info). Uses `status` (row pill), `email.status` +
  `email.to` (line "Email: Sent (demo) to <to>"; text after the first comma is dropped),
  `resume_url` (shown as a link). Treated as success unless the response has `ok: false` or a
  non-2xx code.
- Chat page: `/?resume=<token>` -> `POST /api/session {resumeToken}`. `missing` (labels or keys) is
  mapped to form keys, and the form pop-up opens with only those fields; `reply` is shown as the
  note. Submit goes to the existing `POST /api/form` with the returned `sessionId` (only the shown
  fields are filled). The `resume` param is removed from the address bar after load.

Status labels handled: need_document, missing_info, need_direction, awaiting_review, accepted,
handed_off, approved, rejected, needs_info, pending_review.
