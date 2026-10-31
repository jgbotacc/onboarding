import { ApiResponse, MAX_ROUNDS, type FieldIssue, type FormFields } from "./types";
import { RULES, validateField, type FieldKey } from "./validation"; // [field-validation]
import { FIELDS } from "./staff/fields";

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
  /** Values held while the client fixes rejected fields in the chat. */
  fixing: { fields: FormFields; bad: FieldKey[] } | null;
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

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const plural = (n: number, one: string, many: string) => `${NUMBER_WORDS[n] || n} ${n === 1 ? one : many}`;
const bullets = (items: string[]) => items.map((i) => `\u2022 ${i}`).join("\n");

export function createMock(opts: { resumed?: boolean } = {}) {
  const s: MockState = { registered: false, missing: [], round: 0, status: "registering", designDirection: "", refs: 0, viaPdf: false, fixing: null };

  const resp = (reply: string, images: string[] = []): ApiResponse => ({
    reply,
    images,
    status: s.status,
    missing: s.missing.slice(),
    round: s.round,
  });

  // Labels match the form and the per-line summary.
  const LABELS: Record<FieldKey, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;

  const summary = (fields: FormFields) =>
    FIELDS.filter((f) => (fields[f.key] || "").trim())
      .map((f) => `${f.label}: ${fields[f.key].trim()}`)
      .join("\n");

  const generate = (prefix: string, fields?: FormFields): ApiResponse => {
    s.round += 1;
    s.status = "awaiting_review";
    const first = `Here's a first mockup, based on your details${s.designDirection ? " and style" : ""}.`;
    const again = "Here's the updated version.\nHappy with it? Tap \u201cLooks good\u201d, or tell me what to change.";
    return resp(
      prefix + (s.round === 1 && fields ? `${summary(fields)}\n\n${first}` : s.round === 1 ? first : again),
      [0, 1, 2].map((i) => placeholder(s.round, i)),
    );
  };

  const askMissing = (prefix: string, fields?: FormFields): ApiResponse => {
    if (s.missing.length) {
      s.status = "missing_info";
      return resp(`${prefix}I just need a bit more:\n\n${bullets(s.missing)}\n\nJust type ${s.missing.length > 1 ? "them" : "it"} here.`);
    }
    if (s.viaPdf && !s.refs && s.round === 0) {
      // PDF path has no reference-image field, so ask for refs before the first mockup.
      s.status = "need_direction";
      const shown = fields ? `Here's what I have:\n\n${summary(fields)}\n\n` : "";
      return resp(`${prefix}${shown}Got any images of a style you like?\nUpload JPG or PNG files now, or type \u201cskip\u201d to start.`);
    }
    s.status = "generating";
    return generate(prefix, fields);
  };

  // [field-validation] Mock of the server's sense checks: the shared rules, plus a server-only
  // check for placeholder domains so the "server invalid" path demos with ?mock=1.
  const PLACEHOLDER = /(^|[@./])(example|test|mailinator|domain)\.(com|org|net)$/i;
  const REASON: Record<string, string> = {};
  const checkFields = (fields: FormFields): FieldIssue[] => {
    const out: FieldIssue[] = [];
    (Object.keys(fields) as FieldKey[]).forEach((k) => {
      const v = (fields[k] || "").trim();
      const label = LABELS[k] || k;
      const issue = validateField(k, v, label);
      if (issue) out.push(issue);
      else if (v && k === "email" && PLACEHOLDER.test(v)) {
        REASON[k] = "looks like a placeholder email";
        out.push({ field: k, label, message: "That looks like a placeholder. Use an email we can reach you at.", example: "hello@kopicorner.sg" });
      } else if (v && k === "business_website" && PLACEHOLDER.test(v.replace(/^https?:\/\//i, "").replace(/\/.*$/, ""))) {
        REASON[k] = "looks like a placeholder website";
        out.push({ field: k, label, message: "That looks like a placeholder. Use your real site, or leave it blank.", example: "kopicorner.sg" });
      }
    });
    return out;
  };

  /** One line per bad field: label, the value given, a short reason and one example. */
  const reAsk = (invalid: FieldIssue[], fields: FormFields): ApiResponse => {
    s.fixing = { fields: { ...fields }, bad: invalid.map((i) => i.field as FieldKey) };
    const lines = invalid.map((i) => {
      const k = i.field as FieldKey;
      const reason = REASON[k] ? REASON[k] : `isn't ${RULES[k]?.what || "quite right"}`;
      const ex = RULES[k]?.examples[0] || (i.example || "").split(" or ")[0];
      return `${i.label || LABELS[k] || k}: \u201c${(fields[k] || "").trim()}\u201d ${reason}.${ex ? ` Something like \u201c${ex}\u201d works.` : ""}`;
    });
    delete REASON.email;
    delete REASON.business_website;
    return {
      ...resp(`I just need ${plural(invalid.length, "fix", "fixes")}:\n\n${bullets(lines)}\n\nJust type the corrections here.`),
      status: s.registered ? s.status : (s.status = "missing_info"),
      invalid,
    };
  };

  /** Read typed corrections: "Label: value" lines, or plain values in order. */
  const applyFixes = (text: string) => {
    const f = s.fixing!;
    const lines = text.split(/\n|;/).map((l) => l.trim()).filter(Boolean);
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z]/g, "");
    const left = f.bad.slice();
    const plain: string[] = [];
    lines.forEach((l) => {
      const m = l.match(/^([^:]{2,40}):\s*(.+)$/);
      const k = m && FIELDS.find((x) => norm(x.label) === norm(m[1]) || norm(x.key) === norm(m[1]))?.key;
      if (k && m) {
        f.fields[k] = m[2].replace(/^["\u201c]|["\u201d]$/g, "");
        const at = left.indexOf(k);
        if (at >= 0) left.splice(at, 1);
      } else plain.push(l);
    });
    if (left.length === 1 && plain.length) f.fields[left[0]] = plain.join(" ");
    else left.forEach((k, i) => plain[i] !== undefined && (f.fields[k] = plain[i]));
    return f.fields;
  };

  /** Everything passed: register and show the per-line summary. */
  const register = (fields: FormFields, viaPdf: boolean, prefix = ""): ApiResponse => {
    s.fixing = null;
    s.registered = true;
    s.viaPdf = viaPdf;
    s.missing = REQUIRED.filter((r) => !(fields[r.key] || "").trim() || (r.key === "email" && !EMAIL_RE.test(fields.email))).map((r) => r.label);
    if (fields.design_preferences.trim()) s.designDirection = fields.design_preferences.trim();
    const name = fields.business_name.trim();
    return askMissing(`${prefix}Thanks${name ? `, ${name} is all set up` : ""}!\n\n`, fields);
  };

  const handlers = {
    upload(files: File[]): ApiResponse {
      const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name));
      const pdfs = pdfFiles.length;
      const jpgs = files.length - pdfs;
      s.refs += jpgs;
      const imgs = plural(jpgs, "image", "images");
      if (s.status === "need_direction" && jpgs && !pdfs) return generate(`Got your ${imgs}, thanks.\n\n`);
      if (!s.registered && pdfs === 0) {
        return resp(`Thanks for the ${imgs}!\nNow upload the PDF with your business details so I can set you up.`);
      }
      if (!s.registered) {
        const fields = { ...SAMPLE_PDF };
        if (pdfFiles.some((f) => /invalid/i.test(f.name))) {
          fields.business_type = "123";
          fields.expected_annual_revenue = "cat";
        }
        s.viaPdf = true;
        const invalid = checkFields(fields);
        if (invalid.length) return reAsk(invalid, fields);
        return register(fields, true);
      }
      return resp(`Got ${plural(files.length, "more file", "more files")}. I'll use ${files.length > 1 ? "them" : "it"} in the next design.`);
    },
    form(fields: FormFields): ApiResponse {
      const invalid = checkFields(fields); // [field-validation]
      if (invalid.length) return reAsk(invalid, fields);
      if (opts.resumed && !s.registered) {
        // Resume link: the client is already registered server side; only the flagged fields come back.
        s.registered = true;
        s.missing = [];
        if (fields.design_preferences.trim()) s.designDirection = fields.design_preferences.trim();
        return askMissing("Thanks, your details are updated.\nOur team will take a look.\n\n");
      }
      return register(fields, false);
    },
    chat(text: string): ApiResponse {
      if (s.fixing) {
        const fields = applyFixes(text);
        const invalid = checkFields(fields);
        if (invalid.length) return reAsk(invalid, fields);
        return register(fields, s.viaPdf);
      }
      if (!s.registered) return resp("To start, upload a PDF with your business details, or fill in the form.");
      if (s.status === "missing_info") {
        const before = s.missing.length;
        const parts = text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
        const email = text.match(EMAIL_RE);
        if (email) s.missing = s.missing.filter((m) => m !== "Email");
        const names = parts.filter((p) => !EMAIL_RE.test(p));
        s.missing = s.missing.filter((m) => (m !== "Email" && names.length ? (names.shift(), false) : true));
        if (s.missing.length === before) {
          return resp(`Sorry, I couldn't match that. I still need:\n\n${bullets(s.missing)}`);
        }
        return askMissing("Thanks, got it.\n\n");
      }
      if (s.status === "need_direction") {
        if (!/^\s*(skip|no|none|nope|n\/a|go ahead|proceed)\b/i.test(text)) s.designDirection = text.trim();
        return generate("");
      }
      if (s.status === "awaiting_review") return resp("Tap \u201cLooks good\u201d or \u201cAsk for changes\u201d under the designs.");
      if (s.status === "accepted") return resp("Great, design direction accepted! Our team will contact you shortly.");
      if (s.status === "handed_off") return resp("A designer has your details.\nOur team will contact you shortly.");
      return resp("Got it.");
    },
    review(accepted: boolean, feedback: string): ApiResponse {
      if (accepted) {
        s.status = "accepted";
        return resp("Great, design direction accepted! Our team will contact you shortly.");
      }
      if (s.round >= MAX_ROUNDS) {
        s.status = "handed_off";
        return resp("Thanks for the feedback.\nA designer will take it from here.\nOur team will contact you shortly.");
      }
      return generate(`Thanks, I've made the changes${feedback ? ` (\u201c${feedback}\u201d)` : ""}.\n\n`);
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
