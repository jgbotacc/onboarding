# Decisions and assumptions (v2)

Decisions were made by Jin. Assumptions are ours; Jin can override any of them.

## Decisions (Jin)
- D1. Only Meta models in the app (Muse Spark for chat, document reading, translation; Muse Image for graphics). Jev for checks. No other AI provider.
- D2. Meta spend limit for the build: S$120 in total.
- D3. Client messages are short lines. Existing replies are tightened too, keeping the per-field bullet style. Text comes back as separate lines so each can be read aloud.
- D4. Uploads accept PDFs and phone photos (JPG, PNG, HEIC) of documents. Photos are read with the Meta vision model. Blurry, cropped or unreadable photos get a short "retake" reply plus a flag; we never guess.
- D5. Consult handoff appears on the staff dashboard only. No email or other alert for consults.
- D6. Repo is private, jgbotacc only, no collaborators.
- D7. Resume is a private resume link with no login.
- D8. The real ACRA sample stays out of the repo; tests use a fake ACRA-style fixture with made-up details.

## Assumptions
- A1. Muse Spark 1.3 in **Standard** mode (`muse-spark-1.3`), not Contributor mode, because client documents hold personal data that must not be used for training.
- A2. Cost in S$ uses `USD_SGD` = 1.35 unless the env var is set; Meta prices from the pricing page on 2026-11-03.
- A3. The v1 registration-form PDF (labelled `Label: value` lines the client filled in) counts as the client's own input, so it is saved straight away as in v1. Every other document (ACRA profile, photos) goes through the confirm step.
- A4. A document is "the registration form" when at least two form labels (`Business name:`, `Contact name:`, `Email:` ...) are found and it is not an ACRA profile.
- A5. New fields `uen` and `registered_address` are optional, document-only fields (not on the web form). They show on staff views and in the summary.
- A6. ACRA "Activity" becomes `industry` with the SSIC code in brackets removed and the text sentence-cased; "Type" becomes `business_type`.
- A7. The first Officer whose Position Held is "Director" becomes `contact_name`, and `title_position` = "Director". Their ID number and address are dropped.
- A8. NRIC/FIN pattern: `[STFGM]` + 7 digits + letter. Anything matching is removed at extraction and masked by the outbound guard. UENs (e.g. `T20VC1234Z`, `202012345A`) do not match it.
- A9. Pending extracted details live only in the session draft (needed for save-and-resume). They are not written to the field tables, not shown to staff and not used for images until the client confirms.
- A10. Removing an uploaded document is allowed only while its details are pending. After confirmation the client edits fields in chat or the form instead.
- A11. Language: the client's pick (`POST /api/language`) wins. Otherwise Chinese and Tamil are detected from the script (free), Malay from common words; anything else is English.
- A12. Names, emails, phone numbers, UENs and website addresses are not translated.
- A13. Look round = 3 graphics. Look 1 follows the client's brief as written; looks 2 and 3 are alternatives from the image-brief step. If the brief step fails, fixed alternatives are used ("bold and colourful", "warm and friendly").
- A14. v1 `POST /api/review` still works: `accepted:true` picks look 1; feedback text is used for the next round.
- A15. "Skip" in the look picker (or an empty selection) rejects all three looks of that round.
- A16. The staff decision click (after the UI's confirm step) is the staff approval for that email. `POST .../decision/preview` lets staff read it first. The audit log records who approved it.
- A17. Staff identity for the audit log comes from an optional `x-staff-name` header (default `staff`); the passcode is shared.
- A18. The consult handoff is created automatically with status `pending_approval`; the client is told our staff will arrange a consult. "Booking" the consult is the staff approval of the card.
- A19. Jev grading is an offline sampled script, not part of the running app (the app has no Composio key). Scores are imported into the store and shown in metrics.
- A20. Jev cannot see images, so image fit is graded from the brief plus a short Muse Spark caption of the image.
- A21. Outbound guard: "another client's data" = the email, phone or UEN of any other stored client. Matches are masked as `[removed]` and logged.
- A22. Concurrency: one process, a per-session lock. Multiple workers would need a store-level lock (not needed for the demo).
- A23. Neo4j writes stay one Cypher statement per write (one atomic transaction each), because the v1 relay passes single statements. Not run against the live Aura database during this build (v1 uses it).
- A24. Tests never call Meta: `MODEL_API_KEY` and the relay env are unset in tests and Meta calls are mocked.
- A25. Completion = status `accepted`, `approved`, `rejected` or `pending_review`; time to finish = first stored event to the pick or the last update.
