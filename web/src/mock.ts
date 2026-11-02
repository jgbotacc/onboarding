import { MAX_ROUNDS, type ApiResponse, type ConsultInfo, type ExtractedField, type FormFields, type Lang, type Looks, type TraceKind } from "./types";
import { fieldLabel, t } from "./i18n";

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

/** Active language, shared with the picker via localStorage (default `en`). Mirrors api.getLang without the import cycle. */
function langNow(): Lang {
  try {
    const g = globalThis as unknown as { localStorage?: { getItem(k: string): string | null } };
    const s = g.localStorage?.getItem("onboardingLang");
    if (s === "en" || s === "zh" || s === "ms" || s === "ta") return s;
  } catch {
    /* storage unavailable */
  }
  return "en";
}

// Sample values the mock "reads" from an uploaded PDF (demo data, no NRIC).
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

const ORDER: (keyof FormFields)[] = [
  "business_name", "business_type", "industry", "business_website", "contact_name", "title_position",
  "email", "phone_number", "design_preferences", "expected_annual_revenue", "requirements_notes",
];

const NRIC_RE = /[STFGM]\d{7}[A-Z]/;
const SKIP = /^\s*(skip|no|none|nope|n\/a|go ahead|proceed)\b/i;
const ALT_KEYS = ["mock.alt1", "mock.alt2", "mock.alt3"] as const;

// Gallery-first demo flow: a fresh session opens on the sample poster gallery,
// then asks four questions (business, headline, contact, email) before the looks rounds.
type GalleryPhase = "off" | "pick" | "ask" | "done" | "skipped";

interface MockState {
  step: string;
  fields: Record<string, string>;
  pendingValues: Record<string, string> | null;
  designAsked: boolean;
  round: number;
  skips: number;
  refs: number;
  resumed: boolean;
  gallery: GalleryPhase;
  headlineSkipped: boolean;
}

export function createMock(opts: { resumed?: boolean } = {}) {
  const s: MockState = {
    step: opts.resumed ? "missing_info" : "pick_poster", fields: {}, pendingValues: null, designAsked: false,
    round: 0, skips: 0, refs: 0, resumed: !!opts.resumed,
    gallery: opts.resumed ? "off" : "pick", headlineSkipped: false,
  };
  if (opts.resumed) {
    s.fields = { ...SAMPLE_PDF };
    s.step = "missing_info";
    s.round = 1;
  }

  const toExtracted = (values: Record<string, string>, lang: Lang): ExtractedField[] =>
    ORDER.filter((k) => (values[k] || "").trim())
      .filter((k) => !/^(nric|fin)$/i.test(k) && !NRIC_RE.test(String(values[k]).trim()))
      .map((k) => ({ field: k, label: fieldLabel(lang, k), value: String(values[k]).trim() }));

  const looksForRound = (round: number, lang: Lang): Looks => ({
    round,
    max_rounds: MAX_ROUNDS,
    prompt: t(lang, "mock.lookPrompt"),
    options: [0, 1, 2].map((i) => ({
      id: `r${round}-${"abc"[i]}`,
      url: placeholder(round, i),
      alt: t(lang, ALT_KEYS[i]),
    })),
  });

  const imagesForRound = (round: number): string[] => (round > 0 ? [0, 1, 2].map((i) => placeholder(round, i)) : []);

  // Sample posters shown on the opening gallery (static files, personalised later).
  const GALLERY_ALTS = ["mock.galleryAlt1", "mock.galleryAlt2", "mock.galleryAlt3"] as const;
  const sampleBase = (): string => {
    try {
      const b = import.meta.env.BASE_URL as string | undefined;
      if (b) return b.endsWith("/") ? b : b + "/";
    } catch {
      /* no base configured */
    }
    return "/";
  };
  const galleryLooks = (lang: Lang): Looks => ({
    round: 0,
    max_rounds: MAX_ROUNDS,
    prompt: t(lang, "mock.galleryStart"),
    options: [1, 2, 3].map((n) => ({
      id: `sample-${n}`,
      url: sampleBase() + `samples/sample-${n}.jpg`,
      alt: t(lang, GALLERY_ALTS[n - 1]),
    })),
  });

  // The four gallery questions, in order, with the field each one fills.
  const GSLOTS = ["business_name", "headline", "contact_name", "email"] as const;
  const GSLOT_LABEL = {
    business_name: "field.business_name",
    headline: "field.headline",
    contact_name: "field.contact_name",
    email: "field.email",
  } as const;
  const GSLOT_Q = ["mock.qBusiness", "mock.qHeadline", "mock.qContact", "mock.qEmail"] as const;
  const answered = (slot: (typeof GSLOTS)[number]): boolean => {
    if (slot === "headline") return !!((s.fields.headline || "").trim()) || s.headlineSkipped;
    return !!((s.fields[slot] || "").trim());
  };
  const galleryMissing = (lang: Lang): string[] =>
    GSLOTS.filter((k) => !answered(k)).map((k) => t(lang, GSLOT_LABEL[k]));
  const firstOpen = (): number => {
    const i = GSLOTS.findIndex((k) => !answered(k));
    return i < 0 ? GSLOTS.length : i;
  };
  // Tag gallery replies so the UI can keep the gallery behaviour (flow is gallery).
  const withFlow = (r: ApiResponse): ApiResponse => ({ ...r, flow: "gallery" }) as ApiResponse;

  const askSlot = (i: number): ApiResponse => {
    const lang = langNow();
    return withFlow(out({ reply: t(lang, GSLOT_Q[i]), step: "missing_info", missing: galleryMissing(lang) }));
  };
  const nextGallery = (): ApiResponse => {
    const i = firstOpen();
    if (i >= GSLOTS.length) {
      // All four answers in: hand over to the normal looks flow at round 1.
      const lang = langNow();
      s.round = 1;
      s.gallery = "done";
      const looks = looksForRound(1, lang);
      return withFlow(out({
        reply: t(lang, "mock.looksRound", { round: 1, max: MAX_ROUNDS }),
        step: "awaiting_review", looks,
      }));
    }
    return askSlot(i);
  };
  const galleryPick = (ids: string[]): ApiResponse => {
    const lang = langNow();
    s.gallery = "ask";
    void ids;
    const reply = t(lang, "mock.galleryPicked") + "\n" + t(lang, "mock.qBusiness");
    return withFlow(out({ reply, step: "missing_info", missing: galleryMissing(lang) }));
  };
  const galleryStart = (): ApiResponse => {
    const lang = langNow();
    s.round = 0;
    const looks = galleryLooks(lang);
    return out({ reply: t(lang, "mock.galleryStart"), step: "pick_poster", looks });
  };
  // Chat ids ("1", "2 and 3") or "all" map onto the sample posters.
  const chatPickIds = (text: string): string[] | null => {
    if (/\ball\b/i.test(text || "")) return [1, 2, 3].map((n) => `sample-${n}`);
    const nums = (text || "").match(/[123]/g);
    if (nums?.length) return [...new Set(nums)].map((d) => `sample-${d}`);
    return null;
  };

  /** Consult card data uses English labels (staff UI is English-only). Never empty. */
  const submittedEn = (): Record<string, string> => {
    const src = Object.keys(s.fields).length ? s.fields : s.pendingValues || { business_name: SAMPLE_PDF.business_name };
    const out: Record<string, string> = {};
    for (const k of ORDER) {
      const v = (src[k] || "").trim();
      if (v && !/^(nric|fin)$/i.test(k) && !NRIC_RE.test(v)) out[fieldLabel("en", k)] = v;
    }
    if (!Object.keys(out).length) out[fieldLabel("en", "business_name")] = SAMPLE_PDF.business_name;
    return out;
  };

  /** Trim incoming fields; NRIC/FIN is dropped, never stored. */
  const clean = (fields: Record<string, string>): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields || {})) {
      if (/^(nric|fin)$/i.test(k)) continue;
      const val = String(v ?? "").trim();
      if (!val || NRIC_RE.test(val)) continue;
      out[k] = val;
    }
    return out;
  };

  const out = (p: {
    reply: string; step?: string; looks?: Looks | null; extracted?: ExtractedField[] | null;
    retake?: { reason: string } | null; consult?: ConsultInfo | null; missing?: string[];
  }): ApiResponse => {
    const lang = langNow();
    const step = p.step ?? s.step;
    s.step = step;
    return {
      reply: p.reply,
      lang,
      step,
      status: step,
      images: p.looks ? p.looks.options.map((o) => o.url) : imagesForRound(s.round),
      missing: p.missing ?? [],
      round: s.round,
      looks: p.looks ?? null,
      extracted: p.extracted ?? null,
      retake: p.retake ?? null,
      consult: p.consult ?? null,
    };
  };

  const startLooks = (round: number): ApiResponse => {
    const lang = langNow();
    s.round = round;
    const looks = looksForRound(round, lang);
    return out({ reply: t(lang, "mock.looksRound", { round, max: MAX_ROUNDS }), step: "choosing_look", looks });
  };

  const handlers = {
    upload(files: File[]): ApiResponse {
      const lang = langNow();
      // Uploading before any pick leaves the gallery for the classic document flow.
      // Uploads during the questions keep the existing path below; confirming resumes the questions.
      if (s.gallery === "pick") s.gallery = "off";
      const list = files || [];
      if (!list.length) return out({ reply: t(lang, "mock.needPdf"), step: "registering" });
      if (list.some((f) => /blurry/i.test(f?.name || ""))) {
        return out({ reply: t(lang, "mock.retakeBlurry"), retake: { reason: "blurry" } });
      }
      if (list.some((f) => /cropped/i.test(f?.name || ""))) {
        return out({ reply: t(lang, "mock.retakeCropped"), retake: { reason: "cropped" } });
      }
      const pdfs = list.filter((f) => /\.pdf$/i.test(f?.name || "") || (f as File)?.type === "application/pdf");
      const refs = list.length - pdfs.length;
      if (refs > 0) s.refs += refs;
      if (pdfs.length) {
        const values: Record<string, string> = { ...SAMPLE_PDF };
        if (/invalid/i.test(pdfs[0]?.name || "")) {
          values.business_type = "123";
          values.expected_annual_revenue = "cat";
        }
        s.pendingValues = values;
        s.designAsked = false;
        return out({ reply: t(lang, "mock.confirmAsk"), step: "confirm_details", extracted: toExtracted(values, lang) });
      }
      if (refs > 0) {
        if (s.pendingValues) {
          return out({ reply: t(lang, "mock.gotRefs", { n: refs }), extracted: toExtracted(s.pendingValues, lang) });
        }
        return out({ reply: t(lang, "mock.gotRefs", { n: refs }) });
      }
      return out({ reply: t(lang, "mock.needPdf") });
    },

    form(fields: FormFields): ApiResponse {
      const lang = langNow();
      const updates = clean(fields as unknown as Record<string, string>);
      if (s.resumed) {
        s.resumed = false;
        s.fields = { ...s.fields, ...updates };
        s.pendingValues = null;
        return out({ reply: t(lang, "mock.updated"), step: "pending_review" });
      }
      s.fields = { ...s.fields, ...updates };
      s.pendingValues = null;
      if (s.gallery === "ask") return nextGallery();
      if ((s.fields.design_preferences || "").trim()) {
        s.designAsked = false;
        s.skips = 0;
        return startLooks(1);
      }
      s.designAsked = true;
      return out({ reply: t(lang, "mock.designAsk"), step: "missing_info", missing: ["Design preferences"] });
    },

    confirmExtracted(fields: Record<string, string>): ApiResponse {
      const lang = langNow();
      if (s.resumed) {
        s.resumed = false;
        s.fields = { ...s.fields, ...clean(fields) };
        s.pendingValues = null;
        return out({ reply: t(lang, "mock.updated"), step: "pending_review" });
      }
      const base = s.pendingValues ? { ...s.pendingValues } : { ...s.fields };
      s.fields = { ...base, ...clean(fields) };
      s.pendingValues = null;
      // An upload confirmed mid-questions fills answers and resumes where it left off.
      if (s.gallery === "ask") return nextGallery();
      s.designAsked = true;
      return out({ reply: t(lang, "mock.designAsk"), step: "missing_info", missing: ["Design preferences"] });
    },

    chat(text: string): ApiResponse {
      const lang = langNow();
      if (s.resumed) {
        s.resumed = false;
        return out({ reply: t(lang, "mock.updated"), step: "pending_review" });
      }
      if (s.step === "accepted") return out({ reply: t(lang, "mock.accepted"), step: "accepted" });
      if (s.step === "handed_off") {
        return out({
          reply: t(lang, "mock.consultHandoff"), step: "handed_off",
          consult: { status: "pending_approval", submitted: submittedEn(), next_steps: [t(lang, "mock.nextStep")] },
        });
      }
      if (s.pendingValues) {
        if (/^\s*(yes|y|ok|confirm|looks good|agree)\b/i.test(text || "")) return handlers.confirmExtracted({});
        if (/^\s*(no|n|discard|cancel)\b/i.test(text || "")) {
          s.pendingValues = null;
          // Back to the open gallery question after discarding the upload.
          if (s.gallery === "ask") return nextGallery();
          return out({ reply: t(lang, "mock.removed"), step: "registering" });
        }
        return out({ reply: t(lang, "mock.pendingConfirm"), step: "confirm_details", extracted: toExtracted(s.pendingValues, lang) });
      }
      if (s.gallery === "pick") {
        if (SKIP.test(text || "")) return handlers.skipLooks();
        const ids = chatPickIds(text || "");
        if (ids) return handlers.pickLooks(ids);
        return galleryStart();
      }
      if (s.gallery === "ask") {
        const i = firstOpen();
        const ans = (text || "").trim();
        const storeKey = GSLOTS[i];
        if (i === 1 && SKIP.test(ans)) {
          // The headline alone may be skipped.
          s.headlineSkipped = true;
          return nextGallery();
        }
        if (!ans || (i !== 1 && SKIP.test(ans))) return askSlot(i);
        if (storeKey) s.fields[storeKey] = ans;
        return nextGallery();
      }
      if (s.step === "need_document") {
        const parts = (text || "").split(/[,，\n;；]+/).map((p) => p.trim()).filter(Boolean);
        if (parts.length && !SKIP.test((text || "").trim())) {
          const at = parts.findIndex((p) => p.includes("@"));
          if (at > 0) {
            const [mail] = parts.splice(at, 1);
            parts.push(mail);
          }
          if (parts[0]) s.fields.business_name = parts[0];
          if (parts[1]) s.fields.contact_name = parts[1];
          if (parts[2]) s.fields.email = parts[2];
          if ((s.fields.business_name || "").trim() && (s.fields.contact_name || "").trim() && (s.fields.email || "").trim()) {
            s.gallery = "off";
            return startLooks(1);
          }
        }
        return out({ reply: t(lang, "mock.gallerySkip"), step: "need_document" });
      }
      if (s.designAsked) {
        const ans = (text || "").trim();
        if (ans && !SKIP.test(ans)) s.fields.design_preferences = ans;
        s.designAsked = false;
        s.skips = 0;
        return startLooks(1);
      }
      if (s.step === "choosing_look") {
        if (SKIP.test(text || "") || /skip/i.test(text || "")) return handlers.skipLooks();
        const nums = (text || "").match(/[123]/g);
        if (nums?.length) {
          const ids = [...new Set(nums)].map((d) => `r${s.round}-${"abc"[Number(d) - 1]}`);
          return handlers.pickLooks(ids);
        }
        return handlers.skipLooks();
      }
      if (s.step === "missing_info" && !s.round) {
        if ((text || "").trim() && !SKIP.test((text || "").trim())) s.fields.design_preferences = (text || "").trim();
        s.skips = 0;
        return startLooks(1);
      }
      if (!Object.keys(s.fields).length && !s.round) return out({ reply: t(lang, "mock.needPdf"), step: "registering" });
      return out({ reply: t(lang, "mock.needPdf") });
    },

    pickLooks(ids: string[]): ApiResponse {
      const lang = langNow();
      // Picks on the gallery open the four questions instead of accepting.
      if (s.gallery === "pick") return galleryPick(ids.length ? ids : ["sample-1"]);
      if (s.gallery === "ask") return nextGallery();
      s.resumed = false;
      s.designAsked = false;
      s.pendingValues = null;
      if (!s.round) s.round = 1;
      void ids;
      return out({ reply: t(lang, "mock.accepted"), step: "accepted" });
    },

    skipLooks(): ApiResponse {
      const lang = langNow();
      // Skipping the gallery asks for the business details first (flow leaves the gallery).
      if (s.gallery === "pick" || s.gallery === "ask") {
        s.gallery = "skipped";
        return out({ reply: t(lang, "mock.gallerySkip"), step: "need_document" });
      }
      if (s.designAsked) {
        s.designAsked = false;
        s.skips = 0;
        return startLooks(1);
      }
      if (s.pendingValues) {
        return out({ reply: t(lang, "mock.pendingConfirm"), step: "confirm_details", extracted: toExtracted(s.pendingValues, lang) });
      }
      s.skips += 1;
      if (s.skips >= MAX_ROUNDS) {
        s.round = MAX_ROUNDS;
        const consult: ConsultInfo = {
          status: "pending_approval", submitted: submittedEn(), next_steps: [t(lang, "mock.nextStep")],
        };
        return out({ reply: t(lang, "mock.consultHandoff"), step: "handed_off", consult });
      }
      return startLooks(Math.min((s.round || 0) + 1, MAX_ROUNDS) || 1);
    },

    removeUpload(): ApiResponse {
      const lang = langNow();
      s.pendingValues = null;
      s.designAsked = false;
      const step = s.step === "confirm_details" ? "registering" : s.step;
      return out({ reply: t(lang, "mock.removed"), step });
    },

    review(accepted: boolean, feedback: string): ApiResponse {
      if (accepted) return handlers.pickLooks([]);
      const fb = (feedback || "").trim();
      if (!fb) {
        if (s.step === "choosing_look" || s.round || s.designAsked) return handlers.skipLooks();
        return out({ reply: t(langNow(), "mock.nothingToReview") });
      }
      if (/skip/i.test(fb)) return handlers.skipLooks();
      if (s.designAsked) return handlers.chat(fb);
      if (s.step === "choosing_look" || s.round) return handlers.skipLooks();
      if (s.pendingValues) return handlers.chat(fb);
      return out({ reply: t(langNow(), "mock.nothingToReview") });
    },
  };

  // A fresh session opens on the gallery; a resumed one rejoins its own step.
  const start = opts.resumed ? undefined : galleryStart();
  const delay = <T,>(v: T) => new Promise<T>((res) => setTimeout(() => res(v), 100));
  return {
    start,
    upload: (f: File[]) => delay(handlers.upload(f)),
    form: (f: FormFields) => delay(handlers.form(f)),
    chat: (x: string) => delay(handlers.chat(x)),
    review: (a: boolean, fb: string) => delay(handlers.review(a, fb)),
    pickLooks: (ids: string[]) => delay(handlers.pickLooks(ids)),
    skipLooks: () => delay(handlers.skipLooks()),
    confirmExtracted: (fields: Record<string, string>) => delay(handlers.confirmExtracted(fields)),
    removeUpload: () => delay(handlers.removeUpload()),
    trace: async (_kind: TraceKind, _ok: boolean, _ms: number): Promise<void> => {},
  };
}
