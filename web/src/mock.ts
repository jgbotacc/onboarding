import { ApiResponse, MAX_ROUNDS, type FieldIssue, type FormFields } from "./types";
import { validateField, type FieldKey } from "./validation"; // [field-validation]

const REQUIRED: { key: "business_name" | "contact_name" | "email"; label: string }[] = [
  { key: "business_name", label: "Business name" },
  { key: "contact_name", label: "Contact name" },
  { key: "email", label: "Email" },
];
const EMAIL_RE = /[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+/;

const FILLS = ["#DCE6FF", "#E3F1EA", "#FBEBDD", "#E8EAEE", "#F6E2E2"];

function placeholder(round: number, i: number): string {
  const fill = FILLS[(round * 3 + i) % FILLS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${fill}"/>` +
    `<rect x="24.5" y="24.5" width="463" height="463" fill="none" stroke="#1D2129" stroke-opacity=".12"/>` +
    `<text x="256" y="248" font-family="system-ui,sans-serif" font-size="36" font-weight="600" text-anchor="middle" fill="#1D2129">Placeholder</text>` +
    `<text x="256" y="288" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle" fill="#4E5969">Option ${i + 1}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

interface MockState {
  registered: boolean;
  missing: string[];
  round: number;
  status: string;
  designDirection: string;
  refs: number;
  viaPdf: boolean;
  /** Values held while the client fixes rejected or missing fields in the chat. */
  fixing: { fields: FormFields; bad: FieldKey[]; reason: Partial<Record<FieldKey, string>> } | null;
  fields: FormFields | null;
  pdfName: string;
}

// Sample values the mock "reads" from an uploaded PDF (demo data). A file name with
// "invalid" in it gives "123" as the business type and "cat" as the revenue.
const SAMPLE_PDF: FormFields = {
  business_name: "Slice & Stone Pizzeria Pte Ltd",
  business_type: "Restaurant",
  industry: "Food and Beverage",
  business_website: "https://slicestone.sg",
  contact_name: "Marco Lim",
  title_position: "Owner",
  email: "hello@slicestone.sg",
  phone_number: "+65 6123 4567",
  design_preferences: "Warm and rustic, wood-fired oven feel, tomato red and cream",
  expected_annual_revenue: "S$480,000",
  requirements_notes: "Post for our new truffle pizza, 1-for-1 Tuesdays.",
};

// Live reply wording (src/features/chat/agent.py + src/features/intake/validate.py), so ?mock=1 reads
// exactly like the deployed chat. Keep these in step with the backend.
const LIVE: { key: FieldKey; label: string; what: string; example: string }[] = [
  { key: "business_name", label: "Business name", what: "a business name", example: "Slice & Stone Pizzeria Pte Ltd" },
  { key: "business_type", label: "Business type", what: "a business type", example: "Restaurant" },
  { key: "industry", label: "Industry", what: "an industry", example: "Food and Beverage" },
  { key: "business_website", label: "Business website", what: "a website address", example: "slicestone.sg" },
  { key: "contact_name", label: "Contact name", what: "a person's name", example: "Tan Mei Ling" },
  { key: "title_position", label: "Title / position", what: "a job title", example: "Owner" },
  { key: "email", label: "Email", what: "an email address", example: "name@business.com" },
  { key: "phone_number", label: "Phone number", what: "a phone number", example: "+65 6123 4567" },
  { key: "design_preferences", label: "Design preferences", what: "a design preference", example: "warm and rustic, tomato red and cream" },
  { key: "expected_annual_revenue", label: "Expected annual revenue", what: "an amount", example: "S$250,000" },
  { key: "requirements_notes", label: "Requirements / notes", what: "a description of what you need", example: "A post for our new truffle pizza" },
];
const LIVE_BY = Object.fromEntries(LIVE.map((f) => [f.key, f])) as Record<FieldKey, (typeof LIVE)[number]>;
const SUMMARY_CLOSE = "Using your design preferences and business information. Here is a mockup.";
const UPDATED = "Here is the updated mockup. Happy with this direction? Accept it, or tell me what to change.";
const COUNT = ["", "one fix", "two fixes", "three fixes", "four fixes", "five fixes"];
const works = (k: FieldKey) => `Something like "${LIVE_BY[k].example}" works.`;
const clip = (v: string) => {
  const t = v.replace(/\s+/g, " ").trim();
  return t.length <= 40 ? t : t.slice(0, 39).trimEnd() + "\u2026";
};
const fixMessage = (lines: string[]) =>
  `I just need ${COUNT[lines.length] || "a few fixes"}:\n\n${lines.join("\n")}\n\n` +
  `Just type the ${lines.length === 1 ? "correction" : "corrections"} here.`;
const refsSaved = (n: number) => `Saved ${n} reference image(s).`;

export function createMock(opts: { resumed?: boolean } = {}) {
  const s: MockState = {
    registered: false, missing: [], round: 0, status: "registering", designDirection: "", refs: 0, viaPdf: false,
    fixing: null, fields: null, pdfName: "",
  };

  const resp = (reply: string, images: string[] = []): ApiResponse => ({
    reply,
    images,
    status: s.status,
    missing: s.missing.slice(),
    round: s.round,
  });

  /** Per-line summary shown with the first mockup, then Jin's closing line. */
  const summary = (fields: FormFields) =>
    LIVE.filter((f) => (fields[f.key] || "").trim())
      .map((f) => `${f.label}: ${fields[f.key].trim()}`)
      .concat(["", SUMMARY_CLOSE])
      .join("\n");

  const generate = (prefix: string): ApiResponse => {
    s.round += 1;
    s.status = "awaiting_review";
    return resp(prefix + (s.round === 1 && s.fields ? summary(s.fields) : UPDATED), [0, 1, 2].map((i) => placeholder(s.round, i)));
  };

  // [field-validation] Mock of the server's sense checks: the shared rules, plus a placeholder-domain
  // check so the "server invalid" path demos with ?mock=1.
  const PLACEHOLDER = /(^|[@./])(example|test|mailinator|domain)\.(com|org|net)$/i;
  const checkFields = (fields: FormFields): { issues: FieldIssue[]; reason: Partial<Record<FieldKey, string>> } => {
    const issues: FieldIssue[] = [];
    const reason: Partial<Record<FieldKey, string>> = {};
    (Object.keys(fields) as FieldKey[]).forEach((k) => {
      const v = (fields[k] || "").trim();
      const label = LIVE_BY[k]?.label || k;
      const nope = `That isn't ${LIVE_BY[k]?.what || "quite right"}. ${works(k)}`;
      if (v && validateField(k, v, label)) {
        issues.push({ field: k, label, message: nope, example: LIVE_BY[k].example });
      } else if (v && k === "email" && PLACEHOLDER.test(v)) {
        reason[k] = "looks like a placeholder";
        issues.push({ field: k, label, message: `That looks like a placeholder. ${works(k)}`, example: LIVE_BY[k].example });
      } else if (v && k === "business_website" && PLACEHOLDER.test(v.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))) {
        reason[k] = "looks like a placeholder";
        issues.push({ field: k, label, message: `That looks like a placeholder. ${works(k)}`, example: LIVE_BY[k].example });
      }
    });
    return { issues, reason };
  };
  const missingKeys = (fields: FormFields) =>
    REQUIRED.filter((r) => !(fields[r.key] || "").trim()).map((r) => r.key as FieldKey);

  /** Same block as the live chat: "I just need two fixes:" then one bullet per field. */
  const reAsk = (fields: FormFields, issues: FieldIssue[], reason: Partial<Record<FieldKey, string>>, only?: FieldKey): ApiResponse => {
    const bad = issues.map((i) => i.field as FieldKey);
    const keys = LIVE.map((f) => f.key).filter((k) => bad.includes(k) || missingKeys(fields).includes(k));
    // The live chat fills invalid fields first, then missing ones; replies list them in form order.
    s.fixing = { fields: { ...fields }, bad: [...keys.filter((k) => bad.includes(k)), ...keys.filter((k) => !bad.includes(k))], reason };
    s.missing = keys.map((k) => LIVE_BY[k].label);
    s.status = "missing_info";
    const line = (k: FieldKey) =>
      !bad.includes(k)
        ? `\u2022 ${LIVE_BY[k].label}: I couldn't find one. ${works(k)}`
        : `\u2022 ${LIVE_BY[k].label}: "${clip(fields[k])}" ${reason[k] || `isn't ${LIVE_BY[k].what}`}. ${works(k)}`;
    return { ...resp(fixMessage((only ? [only] : keys).map(line))), invalid: issues };
  };

  /** Everything passed: register, then ask for refs (PDF) or a direction, or go straight to the mockup. */
  const register = (fields: FormFields): ApiResponse => {
    s.fixing = null;
    s.missing = [];
    s.registered = true;
    s.fields = { ...fields };
    const name = fields.business_name.trim();
    const thanks = s.viaPdf && s.pdfName ? `Thanks, I've read ${s.pdfName} and registered ${name}.` : `Thanks, ${name} is registered.`;
    const prefix = s.viaPdf ? "" : "Got your registration form. ";
    s.designDirection = (fields.design_preferences || "").trim();
    if (s.designDirection) {
      if (s.viaPdf && !s.refs) {
        s.status = "need_direction";
        return resp(`${prefix}${thanks}\n\nI'll go with your design preferences: ${s.designDirection}\n\n` +
          'Want to add reference images (JPG or PNG)? Upload them now, or type "skip" to start.');
      }
      return generate(`${prefix}${thanks}\n\n`);
    }
    s.status = "need_direction";
    const refs = s.refs ? `Got ${s.refs} reference image(s). Now tell me` : "You can upload reference images (JPG or PNG) if you have any. Then tell me";
    return resp(`${prefix}${thanks}\n\n${refs} your design direction, something like "minimal, warm, brown and cream", or type "skip".`);
  };

  const intake = (fields: FormFields): ApiResponse => {
    const { issues, reason } = checkFields(fields);
    return issues.length || missingKeys(fields).length ? reAsk(fields, issues, reason) : register(fields);
  };

  const handlers = {
    upload(files: File[]): ApiResponse {
      const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
      const imgs = files.length - pdfFiles.length;
      s.refs += imgs;
      if (pdfFiles.length) {
        const fields = { ...SAMPLE_PDF };
        if (pdfFiles.some((f) => /invalid/i.test(f.name))) {
          fields.business_type = "123";
          fields.expected_annual_revenue = "cat";
        }
        s.viaPdf = true;
        s.pdfName = pdfFiles[pdfFiles.length - 1].name;
        const out = intake(fields);
        return imgs && out.status === "missing_info" ? { ...out, reply: `${out.reply}\n\n${refsSaved(imgs)}` } : out;
      }
      if (s.status === "need_direction" && s.viaPdf && s.round === 0) return generate(`Got ${imgs} reference image(s).\n\n`);
      if (s.status === "need_direction") return resp(`Got ${imgs} reference image(s). Now tell me your design direction, or type "skip".`);
      if (s.fixing) {
        const out = reAsk(s.fixing.fields, checkFields(s.fixing.fields).issues, s.fixing.reason);
        return { ...out, reply: `${refsSaved(imgs)}\n\n${out.reply}` };
      }
      return resp(refsSaved(imgs));
    },
    form(fields: FormFields): ApiResponse {
      if (opts.resumed && !s.registered) {
        // Resume link: the client is already registered server side; only the flagged fields come back.
        const { issues, reason } = checkFields(fields);
        if (issues.length) return reAsk(fields, issues, reason);
        s.registered = true;
        s.missing = [];
        s.status = "pending_review";
        return resp("Thanks, your details are updated. Our team will review them and get back to you.");
      }
      s.viaPdf = false;
      return intake(fields);
    },
    chat(text: string): ApiResponse {
      if (s.fixing) {
        // Like the live chat: the reply fills the first field that still needs fixing.
        const k = s.fixing.bad[0];
        const fields = { ...s.fixing.fields, [k]: (k === "email" ? text.match(EMAIL_RE)?.[0] : null) || text.trim() };
        const { issues, reason } = checkFields(fields);
        if (issues.some((i) => i.field === k)) return reAsk(fields, issues, reason, k);
        return issues.length || missingKeys(fields).length ? reAsk(fields, issues, reason) : register(fields);
      }
      if (!s.registered) return resp("To start, upload a PDF with your business details, or fill in the form.");
      if (s.status === "need_direction") {
        if (!/^\s*(skip|no|none|nope|n\/a|go ahead|proceed)\b/i.test(text)) s.designDirection = text.trim();
        return generate("");
      }
      if (s.status === "awaiting_review") return handlers.review(false, text);
      if (s.status === "accepted") return resp("Your design direction is locked in. Our team will follow up with final collaterals.");
      if (s.status === "pending_review") return resp("Thanks! Our team is reviewing your details and will get back to you.");
      return resp("A team member has been notified and will contact you shortly.");
    },
    review(accepted: boolean, feedback: string): ApiResponse {
      if (accepted) {
        s.status = "accepted";
        return resp("Great, design direction accepted! We'll prepare your marketing collaterals.");
      }
      if (s.round >= MAX_ROUNDS) {
        s.status = "handed_off";
        return resp("Thanks for the feedback. I'm handing you to a human designer, who will contact you shortly with your feedback in hand.");
      }
      if (!feedback.trim()) return resp("What would you like changed? (colours, style, text, layout...)");
      return generate("");
    },
  };

  const delay = <T,>(v: T) => new Promise<T>((res) => setTimeout(() => res(v), 600));
  return {
    upload: (f: File[]) => delay(handlers.upload(f)),
    form: (f: FormFields) => delay(handlers.form(f)),
    chat: (t: string) => delay(handlers.chat(t)),
    review: (a: boolean, fb: string) => delay(handlers.review(a, fb)),
  };
}
