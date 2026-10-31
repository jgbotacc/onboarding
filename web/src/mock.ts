import { ApiResponse, MAX_ROUNDS, type FieldIssue, type FormFields } from "./types";
import { parseAmount, validateField, type FieldKey } from "./validation"; // [field-validation]

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

// ---- Port of the live backend wording (src/features/chat/agent.py, src/features/intake/validate.py,
// src/shared/config.py). Keep these strings identical to the server's. ----

type Key = FieldKey;

/** config.py LABELS: used for the `missing` list (Still needed card). */
const LABELS: Record<Key, string> = {
  business_name: "Business Name", contact_name: "Contact Name", email: "Email", business_type: "Business Type",
  industry: "Industry", business_website: "Business Website", title_position: "Title/Position", phone_number: "Phone Number",
  design_preferences: "Design Preferences", expected_annual_revenue: "Expected Annual Revenue", requirements_notes: "Requirements / Notes",
};
const MANDATORY: Key[] = ["business_name", "contact_name", "email"];

/** agent.py SUMMARY: client-facing labels, in form order. */
const SUMMARY: [Key, string][] = [
  ["business_name", "Business name"], ["business_type", "Business type"], ["industry", "Industry"],
  ["business_website", "Business website"], ["contact_name", "Contact name"], ["title_position", "Title / position"],
  ["email", "Email"], ["phone_number", "Phone number"], ["design_preferences", "Design preferences"],
  ["expected_annual_revenue", "Expected annual revenue"], ["requirements_notes", "Requirements / notes"],
];
const ORDER: Record<string, number> = Object.fromEntries(SUMMARY.map(([k], i) => [k, i]));
const label = (k: Key) => SUMMARY.find(([x]) => x === k)?.[1] || LABELS[k] || k;
const SUMMARY_CLOSE = "Using your design preferences and business information. Here is a mockup.";
const UPDATED = "Here is the updated mockup. Happy with this direction? Accept it, or tell me what to change.";

/** validate.py EXAMPLES (first only), WHAT and LIMITS. */
const EXAMPLE: Record<Key, string> = {
  business_name: "Slice & Stone Pizzeria Pte Ltd", business_type: "Restaurant", industry: "Food and Beverage",
  business_website: "slicestone.sg", contact_name: "Tan Mei Ling", title_position: "Owner", email: "name@business.com",
  phone_number: "+65 6123 4567", design_preferences: "warm and rustic, tomato red and cream",
  expected_annual_revenue: "S$250,000", requirements_notes: "A post for our new truffle pizza",
};
const WHAT: Record<Key, string> = {
  business_name: "a business name", business_type: "a business type", industry: "an industry",
  business_website: "a website address", contact_name: "a person's name", title_position: "a job title",
  email: "an email address", phone_number: "a phone number", design_preferences: "a design preference",
  expected_annual_revenue: "an amount", requirements_notes: "a description of what you need",
};
const LIMITS: Record<Key, number> = {
  business_name: 120, contact_name: 80, business_type: 80, industry: 80, title_position: 80, business_website: 200,
  email: 254, phone_number: 30, expected_annual_revenue: 80, design_preferences: 2000, requirements_notes: 4000,
};
const works = (k: Key) => (EXAMPLE[k] ? `Something like "${EXAMPLE[k]}" works.` : "");
const tooLong = (k: Key) => `that's a bit long. Please keep it under ${LIMITS[k] || 2000} characters.`;
const COUNT: Record<number, string> = { 1: "one fix", 2: "two fixes", 3: "three fixes", 4: "four fixes", 5: "five fixes" };
const clip = (v: string, n = 40) => {
  const t = String(v).split(/\s+/).filter(Boolean).join(" ");
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "\u2026";
};

/** validate.py _issue wording. Detection uses the shared web rules, so odd edge cases may differ from live. */
function issueText(k: Key, v: string): string | null {
  if (v.length > (LIMITS[k] || 2000)) return "T" + tooLong(k).slice(1);
  if (!validateField(k, v)) return null;
  const nope = `That isn't ${WHAT[k]}. ${works(k)}`;
  if (["business_name", "contact_name", "business_type", "industry", "title_position"].includes(k) && /\p{L}/u.test(v) && v.length < 2)
    return `That's a bit short for ${WHAT[k]}. ${works(k)}`;
  if (k === "phone_number" && /^\+?[\d\s\-().]+$/.test(v)) return `A phone number needs 7 to 15 digits. ${works(k)}`;
  if (k === "design_preferences" || k === "requirements_notes") return `That doesn't read like ${WHAT[k]}. ${works(k)}`;
  return nope;
}
const check = (k: Key, v: string) => {
  const t = String(v).trim();
  const msg = t ? issueText(k, t) : null;
  return msg ? { message: msg, example: EXAMPLE[k] } : null;
};
const fixLine = (k: Key, value: string) =>
  String(value).trim().length > (LIMITS[k] || 2000)
    ? `\u2022 ${label(k)}: ${tooLong(k)}`
    : `\u2022 ${label(k)}: "${clip(value)}" isn't ${WHAT[k] || "a valid value"}. ${works(k)}`.trimEnd();
const missingLine = (k: Key) => `\u2022 ${label(k)}: I couldn't find one. ${works(k)}`.trimEnd();
const fixMessage = (lines: string[]) =>
  `I just need ${COUNT[lines.length] || "a few fixes"}:\n\n${lines.join("\n")}\n\n` +
  (lines.length === 1 ? "Just type the correction here." : "Just type the corrections here.");

/** agent.py _money: '480000' or '480k' -> 'S$480,000'; ranges and unparsed text stay as typed. */
const money = (v: string) => {
  if (/\d\s*[a-z]{0,3}\s*(?:-|–|—|\bto\b)\s*\S/i.test(v)) return v;
  const n = parseAmount(v);
  return n !== null ? "S$" + Math.round(n).toLocaleString("en-US") : v;
};

// extract.py regex_extract, for typed replies ("Label: value" lines, an email, a phone, a "... Pte Ltd" name).
const ALIASES: Record<Key, string[]> = {
  business_name: ["business name", "company name", "company", "business"],
  business_type: ["business type", "type of business"],
  industry: ["industry", "sector"],
  business_website: ["business website", "website", "url"],
  contact_name: ["contact name", "contact person", "name of contact"],
  title_position: ["title/position", "title / position", "title", "position", "designation"],
  email: ["email", "e-mail", "email address"],
  phone_number: ["phone number", "phone", "mobile", "tel"],
  design_preferences: ["design preferences", "design preference", "design direction", "style"],
  expected_annual_revenue: ["expected annual revenue", "annual revenue", "revenue"],
  requirements_notes: ["requirements / notes", "requirements/notes", "requirements", "notes"],
};
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\d\s-]{6,}\d)/;
const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
function regexExtract(text: string): Partial<Record<Key, string>> {
  const out: Partial<Record<Key, string>> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  (Object.keys(ALIASES) as Key[]).forEach((k) => {
    const names = [...new Set([...ALIASES[k], LABELS[k].toLowerCase()])].sort((a, b) => b.length - a.length);
    const pat = new RegExp("^\\s*(?:" + names.map(esc).join("|") + ")\\s*\\*?\\s*[:\\-]\\s*(.+)$", "i");
    for (const ln of lines) {
      const m = ln.match(pat);
      if (m && m[1].trim() && !(k in out)) out[k] = m[1].trim();
    }
  });
  if (!out.email && EMAIL.test(text)) out.email = text.match(EMAIL)![0];
  if (!out.phone_number && PHONE.test(text)) out.phone_number = text.match(PHONE)![0].trim();
  if (!out.business_name) {
    const m = text.match(/\b([A-Z][\w&' ]+ (?:Pte\.? Ltd\.?|LLC|Ltd\.?|Inc\.?|Co\.))/);
    if (m) out.business_name = m[1].trim();
  }
  return out;
}
const SKIP = /^\s*(skip|no|none|nope|n\/a|go ahead|proceed)\b/i;

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

interface MockState {
  status: string;
  fields: Partial<Record<Key, string>>;
  invalid: Partial<Record<Key, { message: string; example: string }>>;
  refs: number;
  direction: string | null;
  round: number;
  viaPdf: boolean;
  pdfName: string | null;
  refsPending: boolean;
  refill: Key[];
  resumed: boolean;
  designChanged: boolean;
}

export function createMock(opts: { resumed?: boolean } = {}) {
  const s: MockState = {
    status: "need_document", fields: {}, invalid: {}, refs: 0, direction: null, round: 0, viaPdf: false,
    pdfName: null, refsPending: false, refill: [], resumed: false, designChanged: false,
  };
  if (opts.resumed) {
    // Resume link (staff "I need more information"): an earlier round exists; these fields come back.
    Object.assign(s, { resumed: true, status: "missing_info", round: 1, fields: { ...SAMPLE_PDF },
      refill: ["business_website", "phone_number", "design_preferences"] as Key[] });
  }

  const missingKeys = (): Key[] => {
    const bad = Object.keys(s.invalid) as Key[];
    const base = s.refill.length ? s.refill.slice() : MANDATORY.filter((k) => !s.fields[k]);
    return [...bad, ...base.filter((k) => !bad.includes(k))];
  };
  const invalidList = (): FieldIssue[] =>
    (Object.keys(s.invalid) as Key[]).map((k) => ({ field: k, label: LABELS[k], ...s.invalid[k]! }));

  const resp = (reply: string, images: string[] = []): ApiResponse => ({
    reply,
    images,
    status: s.status,
    missing: missingKeys().map((k) => LABELS[k]),
    round: s.round,
    invalid: invalidList(),
  });
  const images = () => (s.round ? [0, 1, 2].map((i) => placeholder(s.round, i)) : []);

  const setFields = (fields: Partial<Record<Key, string>>) => {
    (Object.keys(fields) as Key[]).forEach((k) => {
      const v = fields[k];
      if (v == null || !String(v).trim()) {
        if (s.invalid[k] && !MANDATORY.includes(k)) {
          delete s.invalid[k];
          delete s.fields[k];
        }
        return;
      }
      const t = String(v).trim();
      const problem = check(k, t);
      s.fields[k] = t;
      if (problem) {
        s.invalid[k] = problem;
        return;
      }
      delete s.invalid[k];
      if ((k === "design_preferences" || k === "requirements_notes") && s.resumed) s.designChanged = true;
      s.refill = s.refill.filter((x) => x !== k);
    });
  };

  const problemLines = (only?: Key[]) => {
    let keys = missingKeys();
    if (only?.length) keys = keys.filter((k) => only.includes(k));
    keys.sort((a, b) => (ORDER[a] ?? 99) - (ORDER[b] ?? 99));
    return keys.map((k) => (s.invalid[k] ? fixLine(k, s.fields[k] || "") : missingLine(k)));
  };

  const summary = () => {
    const f = { ...s.fields };
    if (!f.design_preferences && s.direction) f.design_preferences = s.direction;
    const lines = SUMMARY.filter(([k]) => (f[k] || "").trim() && !s.invalid[k]).map(
      ([k, l]) => `${l}: ${k === "expected_annual_revenue" ? money(f[k]!.trim()) : f[k]!.trim()}`,
    );
    return lines.join("\n") + "\n\n" + SUMMARY_CLOSE;
  };

  const runRound = (): ApiResponse => {
    s.round += 1;
    s.status = "awaiting_review";
    return resp(s.round === 1 ? summary() : UPDATED, images());
  };

  const afterFields = (prefix = "", touched?: Key[], okPrefix = ""): ApiResponse => {
    if (missingKeys().length) {
      s.status = "missing_info";
      const still = (touched || []).filter((k) => s.invalid[k]);
      const lines = touched && touched.length === 1 && still.length ? problemLines(still) : problemLines();
      return resp(prefix + fixMessage(lines));
    }
    prefix += okPrefix;
    const name = s.fields.business_name;
    const pdf = s.pdfName;
    s.pdfName = null;
    const thanks = pdf ? `Thanks, I've read ${pdf} and registered ${name}.` : `Thanks, ${name} is registered.`;
    if (s.resumed) {
      s.resumed = false;
      if (s.designChanged && s.round < MAX_ROUNDS) {
        s.designChanged = false;
        s.direction = s.fields.design_preferences || s.direction;
        const out = runRound();
        return { ...out, reply: prefix + "Thanks, your details are updated. Your design brief changed. " + out.reply };
      }
      s.designChanged = false;
      s.status = "pending_review";
      return resp(prefix + "Thanks, your details are updated. Our team will contact you shortly.", images());
    }
    if (s.fields.design_preferences && !s.round) {
      s.direction = s.fields.design_preferences;
      if (s.viaPdf && !s.refs) {
        // PDF path has no reference-image field, so ask for refs before round 1.
        s.status = "need_direction";
        s.refsPending = true;
        return resp(prefix + `${thanks}\n\nI'll go with your design preferences: ${s.direction}\n\n` +
          'Want to add reference images (JPG or PNG)? Upload them now, or type "skip" to start.');
      }
      const out = runRound();
      return { ...out, reply: prefix + `${thanks}\n\n` + out.reply };
    }
    s.status = "need_direction";
    const refs = s.refs ? `Got ${s.refs} reference image(s). Now tell me` : "You can upload reference images (JPG or PNG) if you have any. Then tell me";
    return resp(prefix + `${thanks}\n\n${refs} your design direction, something like "minimal, warm, brown and cream", or type "skip".`);
  };

  const onDocument = (fields: Partial<Record<Key, string>>, filename: string) => {
    s.viaPdf = true;
    setFields(fields);
    s.pdfName = filename;
    return afterFields();
  };

  const onRefs = (n: number): ApiResponse => {
    s.refs += n;
    if (s.status === "need_direction" && s.refsPending) {
      s.refsPending = false;
      const out = runRound(); // PDF design preferences + these refs
      return { ...out, reply: `Got ${n} reference image(s).\n\n` + out.reply };
    }
    if (s.status === "need_direction") return resp(`Got ${n} reference image(s). Now tell me your design direction, or type "skip".`);
    return s.status !== "missing_info" ? resp(`Saved ${n} reference image(s).`) : afterFields(`Saved ${n} reference image(s).\n\n`);
  };

  const fillFromText = (text: string): Key[] => {
    const m = missingKeys();
    const ext = regexExtract(text);
    const got: Partial<Record<Key, string>> = {};
    (Object.keys(ext) as Key[]).forEach((k) => {
      if (!s.refill.length || m.includes(k)) got[k] = ext[k];
    });
    if (!Object.keys(got).length && m.length) {
      if (s.invalid[m[0]] && !MANDATORY.includes(m[0]) && SKIP.test(text)) got[m[0]] = "";
      else {
        const e = m[0] === "email" ? text.match(EMAIL) : null;
        got[m[0]] = (e ? e[0] : text).trim();
      }
    }
    setFields(got);
    return Object.keys(got) as Key[];
  };

  const onReview = (accepted: boolean, feedback: string): ApiResponse => {
    if (s.status !== "awaiting_review") return resp("There's nothing to review yet.");
    if (accepted) {
      s.status = "accepted";
      return resp("Great, design direction accepted! Our team will contact you shortly.", images());
    }
    const fb = (feedback || "").trim();
    if (s.round >= MAX_ROUNDS) {
      s.status = "handed_off";
      return resp("Thanks for the feedback. I'm handing you to a human designer with your notes. Our team will contact you shortly.");
    }
    if (!fb) return resp("What would you like changed? (colours, style, text, layout...)");
    return runRound();
  };

  const handlers = {
    upload(files: File[]): ApiResponse {
      const pdfFiles = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      const refs = files.length - pdfFiles.length;
      if (pdfFiles.length && refs) s.refs += refs; // refs sent with the PDF count before it is read
      let out: ApiResponse | null = null;
      pdfFiles.forEach((f) => {
        const fields = { ...SAMPLE_PDF };
        if (/invalid/i.test(f.name)) {
          fields.business_type = "123";
          fields.expected_annual_revenue = "cat";
        }
        out = onDocument(fields, f.name);
      });
      if (pdfFiles.length && refs && out!.status === "missing_info") out = { ...out!, reply: out!.reply + `\n\nSaved ${refs} reference image(s).` };
      if (refs && !pdfFiles.length) out = onRefs(refs);
      return out || resp("Please upload a PDF, JPG or PNG.");
    },
    form(fields: FormFields): ApiResponse {
      s.viaPdf = false;
      setFields(fields);
      return afterFields("", undefined, "Got your registration form. ");
    },
    chat(text: string): ApiResponse {
      const st = s.status;
      if (st === "need_document" || st === "missing_info") return afterFields("", fillFromText(text));
      if (st === "need_direction") {
        const pending = s.refsPending;
        s.refsPending = false; // 'skip' keeps the PDF's design preferences
        s.direction = SKIP.test(text) ? (pending ? s.direction : null) : text.trim();
        return runRound();
      }
      if (st === "awaiting_review") return onReview(false, text);
      if (st === "approved" || st === "rejected" || st === "pending_review") {
        const msg = {
          approved: "You're approved! Our team will contact you shortly.",
          rejected: "Thanks for your interest. Our team will contact you shortly.",
          pending_review: "Thanks! We're reviewing your details. Our team will contact you shortly.",
        }[st];
        return resp(msg, images());
      }
      if (st === "accepted") return resp("Your design direction is locked in. Our team will contact you shortly.", images());
      return resp("A designer has your details. Our team will contact you shortly.");
    },
    review(accepted: boolean, feedback: string): ApiResponse {
      return onReview(accepted, feedback);
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
