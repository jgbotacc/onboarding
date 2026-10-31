import { ApiResponse, MAX_ROUNDS, type FormFields } from "./types";

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
    `<text x="256" y="288" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle" fill="#4E5969">Round ${round}, option ${i + 1}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

interface MockState {
  registered: boolean;
  missing: string[];
  round: number;
  status: string;
  designDirection: string;
}

export function createMock() {
  const s: MockState = { registered: false, missing: [], round: 0, status: "registering", designDirection: "" };

  const resp = (reply: string, images: string[] = []): ApiResponse => ({
    reply,
    images,
    status: s.status,
    missing: s.missing.slice(),
    round: s.round,
  });

  const generate = (prefix: string): ApiResponse => {
    s.round += 1;
    s.status = "awaiting_review";
    return resp(
      `${prefix}Here are round ${s.round} concepts based on ${s.round === 1 && s.designDirection ? `your design direction (\u201c${s.designDirection}\u201d)` : "your design direction"}. Do they look right?`,
      [0, 1, 2].map((i) => placeholder(s.round, i)),
    );
  };

  const askMissing = (prefix: string): ApiResponse => {
    if (s.missing.length) {
      s.status = "missing_info";
      const list = s.missing.join(", ").toLowerCase();
      return resp(`${prefix}Some mandatory details are missing: ${list}. Please send ${s.missing.length > 1 ? "them" : "it"} here.`);
    }
    s.status = "generating";
    return generate(prefix);
  };

  const handlers = {
    upload(files: File[]): ApiResponse {
      const pdfs = files.filter((f) => /\.pdf$/i.test(f.name)).length;
      const jpgs = files.length - pdfs;
      if (!s.registered && pdfs === 0) {
        return resp(`Thanks for the ${jpgs} reference image(s). Please also upload the PDF with your business details so I can register you.`);
      }
      if (!s.registered) {
        s.registered = true;
        // Simulated parse: the document has a business and contact name but no email.
        s.missing = ["Email"];
        return askMissing(`I've read your document and registered your business${jpgs ? ` along with ${jpgs} reference image(s)` : ""}. `);
      }
      return resp(`Got ${files.length} more file(s). I'll use them in the next round.`);
    },
    form(fields: FormFields): ApiResponse {
      s.registered = true;
      s.missing = REQUIRED.filter((r) => !(fields[r.key] || "").trim() || (r.key === "email" && !EMAIL_RE.test(fields.email))).map((r) => r.label);
      if (fields.design_preferences.trim()) s.designDirection = fields.design_preferences.trim();
      const name = fields.business_name.trim();
      const ack = s.designDirection ? ` I've noted \u201c${s.designDirection}\u201d as your design direction.` : "";
      return askMissing(`Thanks${name ? `, ${name} is registered` : ", your form is received"}.${ack} `);
    },
    chat(text: string): ApiResponse {
      if (!s.registered) return resp("To get started, please upload a PDF with your business details, plus any JPG reference images.");
      if (s.status === "missing_info") {
        const before = s.missing.length;
        const parts = text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
        const email = text.match(EMAIL_RE);
        if (email) s.missing = s.missing.filter((m) => m !== "Email");
        const names = parts.filter((p) => !EMAIL_RE.test(p));
        s.missing = s.missing.filter((m) => (m !== "Email" && names.length ? (names.shift(), false) : true));
        if (s.missing.length === before) {
          return resp(`I couldn't match that to the missing details. Please send: ${s.missing.join(", ").toLowerCase()}.`);
        }
        return askMissing("Thanks, saved. ");
      }
      if (s.status === "awaiting_review") return resp("Please use \u201cLooks good\u201d or \u201cRequest changes\u201d on the images above.");
      if (s.status === "accepted") return resp("Your designs are approved. Our team will follow up with the final files.");
      if (s.status === "handed_off") return resp("A member of our team has your details and will be in touch shortly.");
      return resp("Noted.");
    },
    review(accepted: boolean, feedback: string): ApiResponse {
      if (accepted) {
        s.status = "accepted";
        return resp("Your design direction is approved. Onboarding is complete and the team will prepare your final marketing materials.");
      }
      if (s.round >= MAX_ROUNDS) {
        s.status = "handed_off";
        return resp(`Thanks for the feedback. We've done ${MAX_ROUNDS} rounds, so I'm handing you over to a member of our team, who will take it from here.`);
      }
      return generate(`Thanks, I've applied your feedback${feedback ? ` (\u201c${feedback}\u201d)` : ""}. `);
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
