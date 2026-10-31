# Staff review API

Page: `/staff` (served by the SPA). No auth (demo only).

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

Every email goes to the demo address `willhanjg01@gmail.com` (DEMO_EMAIL_TO); the client's own
email appears in the body as "Client email on file: ...". Provider: Resend when `RESEND_API_KEY`
is set, otherwise the outbox (status "Sent (demo)").

## Resume
`POST /api/session {resumeToken}` -> the client's session in the usual response shape
`{sessionId, reply, images, status, missing, round}`, with `missing` = only the requested fields.
The chat then asks only for those. When all are filled, status becomes `pending_review`
(a new image round runs only if design_preferences / requirements_notes changed).

Statuses: need_document, missing_info, need_direction, awaiting_review, accepted, handed_off,
approved, rejected, needs_info, pending_review.
