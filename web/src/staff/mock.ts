// Mock staff API (demo data only). Used on ?mock=1 or when /api/staff/* is unreachable.
import type { Consult, DecisionBody, DecisionResult, RejectedLookRound, StaffDetail, StaffMetrics, StaffRow, StepTrace, StudioDraft, StudioDraftsBody, StudioGet, StudioRemixBody, StudioRunResult, StudioSizePreset } from "./types";

function art(title: string, sub: string, bg: string, fg: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  title = esc(title);
  sub = esc(sub);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">` +
    `<rect width="512" height="512" fill="${bg}"/>` +
    `<rect x="48" y="64" width="416" height="220" rx="8" fill="${fg}" fill-opacity=".14"/>` +
    `<circle cx="256" cy="174" r="64" fill="${fg}" fill-opacity=".5"/>` +
    `<text x="256" y="350" font-family="system-ui,sans-serif" font-size="34" font-weight="600" text-anchor="middle" fill="${fg}">${title}</text>` +
    `<text x="256" y="392" font-family="system-ui,sans-serif" font-size="20" text-anchor="middle" fill="${fg}" fill-opacity=".75">${sub}</text>` +
    `<text x="256" y="470" font-family="system-ui,sans-serif" font-size="14" text-anchor="middle" fill="${fg}" fill-opacity=".6">Mock image</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const DETAILS: StaffDetail[] = [
  {
    id: "c-kopi01",
    fields: {
      business_name: "Kopi Corner (demo)",
      business_type: "Cafe",
      industry: "Food & Beverage",
      business_website: "kopicorner.example",
      contact_name: "Mei Tan",
      title_position: "Owner",
      email: "mei@kopicorner.example",
      phone_number: "+65 6000 0001",
      design_preferences: "Warm retro kopitiam, brown and cream",
      expected_annual_revenue: "SGD 400k",
      requirements_notes: "Opening post for the Tiong Bahru branch.",
      uen: "201900001A (demo)",
      registered_address: "1 Demo Street (demo)",
    },
    images: [art("Kopi Corner", "Tiong Bahru opening", "#F3E6D3", "#6B3F1F")],
    reference_images: [art("Reference", "Old shopfront", "#EDE3D6", "#7A5A3A")],
    status: "accepted",
    round: 1,
    mismatch_flags: [
      { field: "uen", intake: "201900001A (demo)", document: "201900002B (demo)", source: "acra-profile-demo.pdf" },
      { field: "registered_address", intake: "1 Demo Street (demo)", document: "2 Sample Road (demo)", source: "acra-profile-demo.pdf" },
    ],
    documents: {
      "doc-demo-1": { filename: "acra-profile-demo.pdf", status: "confirmed", openable: true },
    },
  },
  {
    id: "c-bloom02",
    fields: {
      business_name: "Bloom & Stem (demo)",
      business_type: "Florist",
      industry: "Retail",
      business_website: "",
      contact_name: "Aisha Rahman",
      title_position: "Founder",
      email: "aisha@bloomstem.example",
      phone_number: "",
      design_preferences: "Soft pastel, minimal, lots of white space",
      expected_annual_revenue: "",
      requirements_notes: "Mother's Day promotion banner.",
    },
    images: [
      art("Bloom & Stem", "Option A", "#F6E8EE", "#8A3B5C"),
      art("Bloom & Stem", "Option B", "#EAF2EA", "#2F6B45"),
    ],
    reference_images: [],
    status: "awaiting_review",
    round: 2,
    mismatch_flags: [],
    documents: {},
  },
  {
    id: "c-forge03",
    fields: {
      business_name: "Forge Fitness (demo)",
      business_type: "Gym",
      industry: "Health & Fitness",
      business_website: "forgefit.example",
      contact_name: "Daniel Lim",
      title_position: "Marketing Lead",
      email: "daniel@forgefit.example",
      phone_number: "+65 6000 0003",
      design_preferences: "Bold, dark, high contrast",
      expected_annual_revenue: "SGD 1.2M",
      requirements_notes: "",
    },
    images: [art("Forge Fitness", "Latest design", "#1D2129", "#E8F0FF")],
    reference_images: [art("Reference", "Competitor poster", "#E5E6EB", "#1D2129"), art("Reference", "Brand colours", "#E8F0FF", "#1664FF")],
    status: "handed_off",
    round: 3,
    mismatch_flags: [],
    documents: {
      "doc-demo-2": { filename: "registration-form-demo.pdf", status: "file missing", openable: false },
    },
  },
];

const TRACES: Record<string, StepTrace[]> = {
  "c-kopi01": [
    { step: "read_document", model: "muse-spark-1.3", ok: true, ms: 1840, cost_sgd: 0.0042, at: "2026-10-31T09:02:11Z" },
    { step: "translate", model: "muse-spark-1.3", ok: true, ms: 620, cost_sgd: 0.0011, at: "2026-10-31T09:04:02Z" },
    { step: "image_brief", model: "muse-spark-1.3", ok: true, ms: 2310, cost_sgd: 0.0056, at: "2026-10-31T09:07:44Z" },
    { step: "generate_image", model: "muse-image-1.0", ok: true, ms: 9420, cost_sgd: 0.0135, at: "2026-10-31T09:09:31Z" },
  ],
  "c-bloom02": [
    { step: "read_document", model: "muse-spark-1.3", ok: true, ms: 2010, cost_sgd: 0.0048, at: "2026-10-30T14:20:11Z" },
    { step: "image_brief", model: "muse-spark-1.3", ok: false, ms: 30500, cost_sgd: 0.0021, at: "2026-10-30T14:31:55Z" },
    { step: "image_brief", model: "muse-spark-1.3", ok: true, ms: 2480, cost_sgd: 0.0059, at: "2026-10-30T14:33:02Z" },
    { step: "generate_image", model: "muse-image-1.0", ok: true, ms: 8810, cost_sgd: 0.0135, at: "2026-10-30T14:36:40Z" },
  ],
  "c-forge03": [
    { step: "read_document", model: "muse-spark-1.3", ok: true, ms: 1760, cost_sgd: 0.0041, at: "2026-10-29T02:51:09Z" },
    { step: "image_brief", model: "muse-spark-1.3", ok: true, ms: 2190, cost_sgd: 0.0054, at: "2026-10-29T02:55:37Z" },
    { step: "generate_image", model: "muse-image-1.0", ok: true, ms: 9100, cost_sgd: 0.0135, at: "2026-10-29T02:58:12Z" },
  ],
};
const REJECTED: Record<string, RejectedLookRound[]> = {
  "c-kopi01": [],
  "c-bloom02": [
    {
      round: 1,
      options: [
        { id: "r1-a", url: art("Bloom & Stem", "Round 1 · A", "#F6E8EE", "#8A3B5C"), alt: "Soft pink storefront banner" },
        { id: "r1-b", url: art("Bloom & Stem", "Round 1 · B", "#EAF2EA", "#2F6B45"), alt: "Green botanical poster" },
      ],
    },
    {
      round: 2,
      options: [
        { id: "r2-a", url: art("Bloom & Stem", "Round 2 · A", "#FFF3E0", "#9C6B2F"), alt: "Warm cream Mother's Day card" },
      ],
    },
  ],
  "c-forge03": [
    {
      round: 1,
      options: [
        { id: "r1-a", url: art("Forge Fitness", "Round 1 · A", "#1D2129", "#E8F0FF"), alt: "Dark high-contrast gym poster" },
        { id: "r1-b", url: art("Forge Fitness", "Round 1 · B", "#2B2F36", "#FFB800"), alt: "Black and yellow promo graphic" },
      ],
    },
    {
      round: 2,
      options: [
        { id: "r2-a", url: art("Forge Fitness", "Round 2 · A", "#23272F", "#7DD3FC"), alt: "Steel blue training banner" },
      ],
    },
  ],
};
const CONSULTS: Consult[] = [
  {
    id: "consult-01",
    client_id: "c-bloom02",
    business_name: "Bloom & Stem (demo)",
    status: "pending_approval",
    submitted: {
      "Business name": "Bloom & Stem",
      "Contact name": "Aisha Rahman",
      Email: "aisha@bloomstem.example",
      "Design preferences": "Soft pastel, minimal, lots of white space",
    },
    next_steps: ["Agree a style direction", "Confirm the banner size for the Mother's Day promotion"],
    created: "2026-10-30T15:02:00Z",
  },
  {
    id: "consult-02",
    client_id: "c-forge03",
    business_name: "Forge Fitness (demo)",
    status: "approved",
    submitted: {
      "Business name": "Forge Fitness",
      "Contact name": "Daniel Lim",
      Email: "daniel@forgefit.example",
      "Design preferences": "Bold, dark, high contrast",
    },
    next_steps: ["Book the designer intro call"],
    created: "2026-10-29T04:12:00Z",
    approved_by: "staff:mei",
    decided_at: "2026-10-29T06:40:00Z",
  },
];
const METRICS: StaffMetrics = {
  outcomes: {
    sessions: 3,
    completed: 2,
    completion_rate: 0.67,
    avg_minutes_to_finish: 18.5,
    avg_fields_needing_fixes: 1.3,
    avg_rounds_to_pick: 1.5,
    consult_rate: 0.33,
  },
  steps: [
    { step: "read_document", model: "muse-spark-1.3", calls: 3, ok_rate: 1, avg_latency_ms: 1870, cost_sgd: 0.0131 },
    { step: "image_brief", model: "muse-spark-1.3", calls: 4, ok_rate: 0.75, avg_latency_ms: 9295, cost_sgd: 0.019 },
    { step: "generate_image", model: "muse-image-1.0", calls: 3, ok_rate: 1, avg_latency_ms: 9110, cost_sgd: 0.0405 },
  ],
  total_cost_sgd: 0.0726,
  errors: [{ step: "image_brief", model: "muse-spark-1.3", ok: false, ms: 30500, cost_sgd: 0.0021, at: "2026-10-30T14:31:55Z" }],
  evals: { doc_extraction_accuracy: 0.92, image_fit: 0.85, n: 12, at: "2026-10-28T00:00:00Z" },
};
const SUBMITTED = ["2026-10-31T09:12:00Z", "2026-10-30T14:40:00Z", "2026-10-29T03:05:00Z"];

const STATUS_AFTER: Record<string, string> = { approve: "approved", reject: "rejected", more_info: "needs_info" };

const STUDIO_CAP = 9;

const STUDIO_PRESETS = [
  { id: "post", label: "Square post", w: 1080, h: 1080 },
  { id: "story", label: "Story", w: 1080, h: 1920 },
  { id: "flyer", label: "Flyer", w: 1240, h: 1754 },
];

const STUDIO_CHIPS = [
  { id: "add_logo", label: "Add logo", text: "Include the business logo prominently at the top of the design" },
  { id: "less_text", label: "Less text", text: "Keep text minimal, only the headline offer and the business name" },
  { id: "match_photos", label: "Match photos", text: "Match the colours and style of the attached reference photos" },
  { id: "festive", label: "Festive", text: "Festive look with warm celebratory accents" },
  { id: "bolder_headline", label: "Bolder headline", text: "Make the headline extra big and bold, the dominant element" },
];

const STUDIO_STYLES = [
  { title: "Your brief", style: "Warm retro layout in brand colours" },
  { title: "Minimal pastel", style: "Soft pastel, minimal, lots of white space" },
  { title: "Bold contrast", style: "Bold, dark, high contrast headline" },
  { title: "Festive warm", style: "Festive look with warm celebratory accents" },
];

const PRESET_SIZE: Record<StudioSizePreset, { w: number; h: number }> = {
  post: { w: 1080, h: 1080 },
  story: { w: 1080, h: 1920 },
  flyer: { w: 1240, h: 1754 },
};

function studioArt(title: string, sub: string, bg: string, fg: string, w: number, h: number): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<rect x="${w * 0.09}" y="${h * 0.12}" width="${w * 0.82}" height="${h * 0.34}" rx="8" fill="${fg}" fill-opacity=".14"/>` +
    `<circle cx="${w / 2}" cy="${h * 0.29}" r="${Math.min(w, h) * 0.12}" fill="${fg}" fill-opacity=".5"/>` +
    `<text x="${w / 2}" y="${h * 0.58}" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) * 0.067)}" font-weight="600" text-anchor="middle" fill="${fg}">${esc(title)}</text>` +
    `<text x="${w / 2}" y="${h * 0.58 + Math.round(Math.min(w, h) * 0.06)}" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) * 0.039)}" text-anchor="middle" fill="${fg}" fill-opacity=".75">${esc(sub)}</text>` +
    `<text x="${w / 2}" y="${h * 0.92}" font-family="system-ui,sans-serif" font-size="${Math.round(Math.min(w, h) * 0.027)}" text-anchor="middle" fill="${fg}" fill-opacity=".6">Mock image</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

const STUDIO_BG: [string, string][] = [
  ["#F3E6D3", "#6B3F1F"],
  ["#F6E8EE", "#8A3B5C"],
  ["#EAF2EA", "#2F6B45"],
  ["#1D2129", "#E8F0FF"],
  ["#FFF3E0", "#9C6B2F"],
  ["#E8F0FF", "#1664FF"],
];

export function createStaffMock() {
  const db = DETAILS.map((d) => ({ ...d, traces: TRACES[d.id] || [] }));
  const consultDb = CONSULTS.map((c) => ({ ...c }));
  const draftsDb = new Map<string, StudioDraft[]>();
  let seq = 0;
  const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 300));
  const draftsFor = (cid: string): StudioDraft[] => {
    let list = draftsDb.get(cid);
    if (!list) {
      list = [];
      draftsDb.set(cid, list);
    }
    return list;
  };
  const usage = (cid: string) => {
    const list = draftsFor(cid);
    const used = list.filter((d) => d.status === "ok").length;
    return { list, used, remaining: STUDIO_CAP - used };
  };
  const briefFor = (cid: string): Record<string, string> => {
    const d = db.find((x) => x.id === cid);
    const f = d?.fields || {};
    const brief: Record<string, string> = {};
    if (f.business_name) brief.business_name = String(f.business_name);
    if (f.business_type) brief.business_type = String(f.business_type);
    if (f.industry) brief.industry = String(f.industry);
    const prefs = (f as Record<string, unknown>).design_preferences;
    if (typeof prefs === "string" && prefs.trim()) brief.design_preferences = prefs;
    const notes = (f as Record<string, unknown>).requirements_notes;
    if (typeof notes === "string" && notes.trim()) brief.requirements_notes = notes;
    return brief;
  };
  const makeDraft = (cid: string, name: string, preset: StudioSizePreset, styleIdx: number, extra?: Partial<StudioDraft>): StudioDraft => {
    seq += 1;
    const size = PRESET_SIZE[preset] || PRESET_SIZE.post;
    const [bg, fg] = STUDIO_BG[seq % STUDIO_BG.length];
    const style = STUDIO_STYLES[styleIdx % STUDIO_STYLES.length];
    const runId = extra?.run_id || `mock-run-${seq}`;
    return {
      id: `mock-draft-${seq}`,
      run_id: runId,
      parent_id: extra?.parent_id ?? null,
      parent_kind: extra?.parent_kind ?? null,
      preset,
      width: size.w,
      height: size.h,
      url: studioArt(name, style.title, bg, fg, size.w, size.h),
      status: "ok",
      style_title: style.title,
      marketer_prompt: extra?.marketer_prompt ?? null,
      chips: extra?.chips ?? [],
      author: "staff:demo",
      starred: false,
      pinned_to: null,
      pinned_consult_id: null,
      error: null,
      sent_at: null,
      created_at: new Date().toISOString(),
    };
  };
  return {
    list: (): Promise<StaffRow[]> =>
      wait(
        db.map((d, i) => ({
          id: d.id,
          business_name: d.fields.business_name || "",
          contact_name: d.fields.contact_name || "",
          email: d.fields.email || "",
          status: d.status,
          round: d.round,
          industry: d.fields.industry || "",
          updated: SUBMITTED[i] || SUBMITTED[0],
          image: d.images[d.images.length - 1] || null,
        })),
      ),
    detail: (id: string): Promise<StaffDetail> => {
      const d = db.find((x) => x.id === id);
      return d ? wait(d) : Promise.reject(new Error("HTTP 404"));
    },
    decide: (id: string, body: DecisionBody): Promise<DecisionResult> => {
      const d = db.find((x) => x.id === id);
      if (!d) return Promise.reject(new Error("HTTP 404"));
      d.status = STATUS_AFTER[body.decision];
      return wait({
        ...d,
        status: d.status,
        email: { status: "Sent (demo)", to: d.fields.email, subject: "Mock email", sent_at: new Date().toISOString() },
        resume_url: body.decision === "more_info" ? "./?resume=demo-token&mock=1" : null,
      });
    },
    rejectedLooks: (id: string): Promise<RejectedLookRound[]> => {
      if (!db.some((x) => x.id === id)) return Promise.reject(new Error("HTTP 404"));
      return wait(REJECTED[id] || []);
    },
    consults: (): Promise<Consult[]> => wait(consultDb),
    approveConsult: (id: string): Promise<Consult> => {
      const c = consultDb.find((x) => x.id === id);
      if (!c) return Promise.reject(new Error("HTTP 404"));
      c.status = "approved";
      c.approved_by = "staff:demo";
      c.decided_at = new Date().toISOString();
      return wait(c);
    },
    metrics: (): Promise<StaffMetrics> => wait(METRICS),
    studio: (cid: string): Promise<StudioGet> => {
      if (!db.some((x) => x.id === cid)) return Promise.reject(new Error("HTTP 404"));
      const { list, used, remaining } = usage(cid);
      const avoid = (REJECTED[cid] || []).flatMap((g) =>
        g.options.map((o) => ({ id: o.id, title: o.title || o.alt, brief: o.brief || o.alt, url: o.url })),
      );
      return wait({ brief: briefFor(cid), avoid, presets: STUDIO_PRESETS, chips: STUDIO_CHIPS, drafts: list, cap: STUDIO_CAP, used, remaining });
    },
    generateDrafts: (cid: string, body: StudioDraftsBody): Promise<StudioRunResult> => {
      if (!db.some((x) => x.id === cid)) return Promise.reject(new Error("HTTP 404"));
      const { list, remaining } = usage(cid);
      if (remaining < 3) return Promise.reject(new Error(`Draft limit reached — only ${remaining} of ${STUDIO_CAP} drafts left.`));
      const name = db.find((x) => x.id === cid)?.fields.business_name || "Mock draft";
      const runId = `mock-run-${Date.now().toString(36)}-${seq + 1}`;
      const preset = body.preset || "post";
      const chips = (body.chips || []).filter((c) => STUDIO_CHIPS.some((s) => s.id === c));
      const base = seq;
      const made = [0, 1, 2].map((i) =>
        makeDraft(cid, name, preset, base + i, { run_id: runId, marketer_prompt: (body.marketer_prompt || "").slice(0, 500) || null, chips }),
      );
      list.push(...made);
      return wait({ run_id: runId, drafts: made, remaining: STUDIO_CAP - usage(cid).used });
    },
    remixDraft: (cid: string, body: StudioRemixBody): Promise<StudioRunResult> => {
      if (!db.some((x) => x.id === cid)) return Promise.reject(new Error("HTTP 404"));
      const { list, remaining } = usage(cid);
      if (remaining < 1) return Promise.reject(new Error(`Draft limit reached — only ${remaining} of ${STUDIO_CAP} drafts left.`));
      const src = body.source_kind === "draft" ? list.find((d) => d.id === body.source_id) : (REJECTED[cid] || []).flatMap((g) => g.options).find((o) => o.id === body.source_id);
      if (!src) return Promise.reject(new Error("HTTP 404"));
      const name = db.find((x) => x.id === cid)?.fields.business_name || "Mock draft";
      const runId = `mock-run-${Date.now().toString(36)}-${seq + 1}`;
      const preset = body.preset || (body.source_kind === "draft" ? ((src as StudioDraft).preset as StudioSizePreset) : "post") || "post";
      const made = makeDraft(cid, name, preset, seq, {
        run_id: runId,
        parent_id: body.source_id,
        parent_kind: body.source_kind,
        marketer_prompt: (body.note || "").slice(0, 300) || null,
        chips: [],
      });
      list.push(made);
      return wait({ run_id: runId, drafts: [made], remaining: STUDIO_CAP - usage(cid).used });
    },
    starDraft: (cid: string, draftId: string, starred: boolean): Promise<StudioDraft> => {
      const d = draftsFor(cid).find((x) => x.id === draftId);
      if (!d) return Promise.reject(new Error("HTTP 404"));
      d.starred = starred;
      return wait(d);
    },
    pinDraft: (cid: string, draftId: string, target: "client" | "consult" | null): Promise<StudioDraft> => {
      const d = draftsFor(cid).find((x) => x.id === draftId);
      if (!d) return Promise.reject(new Error("HTTP 404"));
      if (target === "consult" && !consultDb.some((c) => c.client_id === cid)) {
        return Promise.reject(new Error("This client has no consult."));
      }
      d.pinned_to = target;
      d.pinned_consult_id = target === "consult" ? consultDb.find((c) => c.client_id === cid)?.id ?? null : null;
      return wait(d);
    },
    sendDraft: (cid: string, draftId: string): Promise<StudioDraft> => {
      const d = draftsFor(cid).find((x) => x.id === draftId);
      if (!d) return Promise.reject(new Error("HTTP 404"));
      if (d.sent_at) return Promise.reject(new Error("This draft was already sent."));
      if (d.status !== "ok" || !d.url) return Promise.reject(new Error("Only finished drafts can be sent."));
      d.sent_at = new Date().toISOString();
      return wait(d);
    },
  };
}
