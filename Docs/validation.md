# Field sense checks

One module, `src/features/intake/validate.py`, checks every value from the PDF, the pop-up form
(`/api/form`), chat answers and resume-link answers (all go through `agent._set_fields`).

- Invalid values are kept (`fields[key]`), flagged in session `invalid`, saved as Neo4j `Field.valid=false`
  (+ `Field.issue`) and SQLite `field_values.valid=0`, and counted in `missing`, so onboarding can't finish.
- Every chat API response (`/api/session`, `/api/upload`, `/api/form`, `/api/chat`, `/api/review`, resume)
  has `invalid: [{field, label, message, example}]` (empty list when none).
- The reply re-asks only those fields: "<message> Please re-enter your <label>, for example '<ex1>' or '<ex2>'."
- Fix by sending a valid value. An invalid optional field can be cleared with an empty value in `/api/form`,
  or "skip" in chat.

| Field | Rule | Example shown |
|---|---|---|
| business_name | has letters, 2-120 chars | Kopi Corner Pte Ltd |
| contact_name | letters, no digits/@, 2-80 chars | Tan Mei Ling |
| business_type, industry, title_position | mostly letters, real words (not 123 / asdfgh) | Café; Food & Beverage; Owner |
| email | name@domain.tld | jo@kopicorner.sg |
| phone_number | 7-15 digits, + spaces dashes brackets dots | +65 9123 4567 |
| business_website | domain or http(s) URL | kopicorner.sg |
| expected_annual_revenue | amount: digits, k/m/bn, currency, "a month"/"per year", ranges, or number words | S$250,000 or five thousand dollars |
| design_preferences, requirements_notes | real words, not gibberish or only symbols | warm, minimal, brown and cream |
