# Pick-the-poster onboarding (branch `poc-gallery`)

**Pick the poster you like first, and we ask only what it needs to make it yours.**

## Who it is for

Small business owners (cafes, salons, shops) who want marketing material but are not comfortable with forms or design terms. Many are on a phone. Some prefer Chinese, Malay or Tamil. Many give up when the first screen asks for company registration details.

## What is different

Most onboarding starts with a form and ends with a design. This one is the other way round:

1. **The first screen is three sample posters** (warm and cosy, bold and bright, clean and premium). Pick one or more, or skip to the classic flow.
2. **Then it asks only what that poster needs:** the business name, then what the poster should say (for example "20% off all coffee this week", or skip). After that it asks for the contact name and email, one question at a time.
3. **Uploading a document is still a shortcut.** The first question offers it, and the upload button stays available. A PDF or phone photo of an ACRA profile fills in the fields.
4. **The pick is the brief.** The chosen style becomes the design direction, and the picked sample is sent as a style reference. The first round of looks already matches the client's taste.

## Why it is smoother

- **The value comes first.** The client sees what they will get before being asked for anything. Picking a picture is easier than describing a style in words.
- **Fewer, easier questions.** The first questions are ones every owner can answer (name and offer). There is no "design preferences" question because the pick answers it. The reference-image question is skipped too.
- **No dead end.** Skip in the gallery goes to the normal upload-or-type flow. Typing details straight away also works, and the gallery steps aside.
- **The same safety as v2.** Confirm before save, NRIC numbers dropped, staff review, consult handoff after 3 skipped rounds, traces and the audit log are all unchanged.
- **Cheap to run.** The gallery samples are static files in the repo, so showing them costs no model calls. Model spend starts only when real looks are made.

## How it fits

It is the same backend and agent as v2. Only the order of the steps and the first screens change. A new session asks for it with `{"flow": "gallery"}` on `POST /api/session`. Without that, the classic v2 flow runs unchanged.
