# Flows

## Client flow (`client-flow.png`)
Real screenshots from a local run of main (placeholder images in place of Muse Image, SQLite in place of Neo4j). They show the client chat from the start screen through both ways in (PDF or form), the field check, the image rounds, and the two endings: accepted, or handed off to a human.

1. The client opens the chat. It offers **Upload PDF** or **Fill in a new form**, and there's no message box yet.
2. The PDF is uploaded and read into fields. Each field is sense-checked: revenue "cat" is rejected with an example ("S$250,000" or "five thousand dollars"), and "Still needed" lists only the missing or invalid fields.
3. The client fixes the value, and the bot asks only for what's still missing (Email).
4. The client is registered and asked for optional reference images and a design direction (or "skip"). If the PDF already has design preferences, it only asks for reference images (JPG or PNG): uploading them or saying "skip" starts round 1 with those preferences.
5. Or the client uses the form: 11 fields, 3 mandatory, with design direction and optional reference images.
6. Muse Image makes a 1080 x 1080 post (round 1 of 3), with **Looks good** and **Request changes**.
7. Feedback is applied to the previous image.
8. If round 3 isn't accepted, a human designer takes over (`handed_off`).
9. **Looks good** marks the design direction as accepted.

## Staff flow (`staff-flow.png`)
The SaaS staff review page at `/#/staff`, the three decisions and their emails, and the one-time resume link that brings the client back to the chat.

10. The staff page lists one row per client: latest image, business, contact, email and status.
11. Expanding a row shows every field, the generated and reference images, and the three actions.
12. Approve (confirmed) sends "Our operations team will get in contact with you soon."
13. Reject (confirmed) sends the rejection email.
14. I need more information: staff tick fields and add a note.
15. The email carries a one-time link, `/?resume=<token>`.
16. The link opens the chat asking only for the ticked fields, and the answers are sense-checked.
17. The three decision emails. All go to the address in `ONBOARDING_NOTIFY_EMAIL` for the demo.

## What makes it stand out
Client (`client-flow.png`):
1. Sense check on every field, re-asked with an example. The same check covers PDF, form, chat and resume-link answers (`src/features/intake/validate.py`).
2. Asks only for missing or invalid fields (`src/features/chat/agent.py`).
3. The PDF is read automatically into the form fields (`src/features/intake/extract.py`).
4. The message box stays hidden until a PDF or the form is in (`web/src/App.tsx`).
5. Optional reference images are passed to Muse Image (`src/features/imagegen/providers.py`).
6. Design direction is saved with the client record in Neo4j (`src/features/chat/agent.py`, `src/data/neo4j_store.py`).
7. Every post is exactly 1080 x 1080 (`src/features/imagegen/providers.py`).
8. Feedback rounds edit the previous image (`src/features/imagegen/providers.py`).
9. Automatic hand-off to a human after 3 rounds (`src/features/chat/agent.py`, `src/data/neo4j_store.py`).

Staff (`staff-flow.png`):
1. One-click Approve, Reject or I need more information, with a confirm step and an automatic email (`web/src/staff/StaffPage.tsx`, `src/features/staff/routes.py`, `src/features/staff/email.py`).
2. A one-time resume link asks only for the ticked fields. Once they're submitted, it returns "This link has already been used" (`src/features/staff/routes.py`).
3. API keys stay off the sandbox: Neo4j, Muse Image and Resend go through a relay that holds the keys and checks a shared secret (`src/shared/relay.py`).

## Data flow (`data-flow.png`)
What moves between the browser, the FastAPI back end in the Daytona sandbox, the Vercel relay, Neo4j Aura, Meta Muse Image and Resend, with real endpoint names and Neo4j labels from `neo4j/schema.cypher` and `src/data/neo4j_store.py`.

1. The browser sends a PDF, form JSON, reference JPG/PNGs, chat text or a review to the `/api/*` endpoints.
2. The back end replies with `{reply, images, status, missing, round}`.
3. Each change is written to Neo4j (Client, Document, Field, FieldDef, ReferenceImage, GenerationRound, HumanHandoff, Decision, Email).
4. Muse Image gets the prompt plus reference images (or the previous image and feedback) and returns a PNG.
5. Staff decisions go to `POST /api/staff/clients/:id/decision {decision, fields, note}`.
6. The decision email goes out through Resend, or is kept in the outbox as "Sent (demo)".
7. The "more info" link brings the client back through `POST /api/session {resumeToken}`.

The live Daytona sandbox reaches Neo4j Aura, Muse Image and Resend through the Vercel relay, which holds the API keys and only accepts calls carrying a shared secret.
