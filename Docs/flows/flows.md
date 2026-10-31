# Flows

## User flow (`user-flow.png`)
A storyboard of real screenshots from a local run of the app (placeholder images instead of Muse, SQLite instead of Neo4j, emails kept in the outbox as "Sent (demo)"). It shows both client paths (Upload PDF and Fill in a new form), the missing-fields prompt, the feedback loop that ends in a hand-off after 3 rounds, and the staff review page with its three decisions and the one-time resume link.

1. Client opens the chat and picks **Upload PDF** or **Fill in a new form**.
2. A: the PDF is parsed (`POST /api/upload`) and the bot asks for any missing mandatory field (Business Name, Contact Name, Email). B: the pop-up form has 11 fields (3 mandatory) plus optional reference images (`/api/upload` first, then `POST /api/form`).
3. A: once the fields are valid the client is registered and asked for reference images and a design direction (or "skip"). B: if Design Preferences were filled in, the bot goes straight to round 1.
4. A square marketing post is generated (Muse Image when `MODEL_API_KEY` is set; Pillow placeholder otherwise), round 1 of 3.
5. **Request changes** sends feedback (`POST /api/review`) and regenerates, up to 3 rounds.
6. If round 3 isn't accepted, the client is handed off to a human (`handed_off`, HumanHandoff node).
7. **Looks good** marks the client `accepted`.
8. Staff open `/#/staff`: one row per client (business, contact, email, status, latest image).
9. Expanding a row shows every field, the generated and reference images, and Reject, I need more information and Approve.
10. Approve (confirmed) sets `approved` and emails "Our operations team will get in contact with you soon."
11. Reject (confirmed) sets `rejected` and sends the rejection email.
12. I need more information: staff tick fields and add a note.
13. The email carries a one-time link `/?resume=<token>`.
14. The link reopens the chat (`POST /api/session {resumeToken}`), which asks only for the flagged fields.
15. All emails go to willhanjg01@gmail.com for the demo, with the client's email shown in the body.

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
