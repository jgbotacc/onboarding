// Mock staff API (demo data only). Used on ?mock=1 or when /api/staff/* is unreachable.
import type { Consult, DecisionBody, DecisionResult, DesignerRow, FeedbackEntry, FinalUploadResult, RejectedLookRound, ShareCreated, ShareLink, ShortlistView, StaffDetail, StaffRow, StepTrace, StudioDraft, StudioDraftsBody, StudioGet, StudioRemixBody, StudioRunResult, StudioSizePreset } from "./types";
import { zipStore } from "./zip";

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
    },
    images: [art("Kopi Corner", "Tiong Bahru opening", "#F3E6D3", "#6B3F1F")],
    reference_images: [art("Reference", "Old shopfront", "#EDE3D6", "#7A5A3A")],
    status: "accepted",
    round: 1,
    transcript: [
      { role: "assistant", text: "Welcome! Tell me about your business.", at: "2026-10-31T09:00:02Z" },
      { role: "client", text: "Kopi Corner, Tiong Bahru branch opening next month.", at: "2026-10-31T09:01:20Z" },
    ],
    documents: { "doc-acra": { filename: "ACRA-profile.pdf", status: "confirmed" } },
    looks: [{ id: "lk-k1", url: art("Kopi Corner", "Final post", "#F3E6D3", "#6B3F1F"), title: "Warm retro kopitiam post", brief: "Brown and cream storefront", round: 1, selected: true, at: "2026-10-31T09:09:31Z" }],
    consult: null,
    decisions: [{ decision: "approve", at: "2026-10-31T09:11:00Z" }],
    outbox: [{ status: "Sent (demo)", to: "mei@kopicorner.example", subject: "Approved", sent_at: "2026-10-31T09:11:05Z" }],
    audit: [
      { at: "2026-10-31T09:02:11Z", actor: "system", action: "document_uploaded", target: "doc-acra" },
      { at: "2026-10-31T09:09:31Z", actor: "client", action: "look_selected", target: "lk-k1" },
      { at: "2026-10-31T09:11:00Z", actor: "staff:demo", action: "decision_approve", target: "lk-k1" },
    ],
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
    transcript: [
      { role: "assistant", text: "Welcome! Tell me about your business.", at: "2026-10-30T14:10:02Z" },
      { role: "client", text: "Bloom & Stem florist, Mother's Day banner.", at: "2026-10-30T14:12:40Z" },
      { role: "assistant", text: "Got it — soft pastel, lots of white space?", at: "2026-10-30T14:13:05Z" },
    ],
    documents: {
      "doc-acra": { filename: "ACRA-profile.pdf", status: "confirmed" },
      "doc-shop": { filename: "shopfront.jpg", status: "confirmed" },
    },
    looks: [
      { id: "r1-a", url: art("Bloom & Stem", "Round 1 · A", "#F6E8EE", "#8A3B5C"), title: "Round 1 · A", brief: "Soft pink storefront banner", round: 1, selected: false, at: "2026-10-30T14:36:40Z" },
      { id: "r1-b", url: art("Bloom & Stem", "Round 1 · B", "#EAF2EA", "#2F6B45"), title: "Round 1 · B", brief: "Green botanical poster", round: 1, selected: false, at: "2026-10-30T14:36:41Z" },
      { id: "r2-a", url: art("Bloom & Stem", "Round 2 · A", "#FFF3E0", "#9C6B2F"), title: "Round 2 · A", brief: "Warm cream Mother's Day card", round: 2, selected: false, at: "2026-10-30T14:38:02Z" },
    ],
    consult: {
      id: "consult-01",
      client_id: "c-bloom02",
      business_name: "Bloom & Stem (demo)",
      status: "pending_approval",
      submitted: { "Design preferences": "Soft pastel, minimal, lots of white space" },
      next_steps: ["Agree a style direction", "Confirm the banner size"],
      created: "2026-10-30T15:02:00Z",
    },
    decisions: [],
    outbox: [],
    audit: [
      { at: "2026-10-30T14:20:11Z", actor: "system", action: "document_uploaded", target: "doc-acra" },
      { at: "2026-10-30T14:22:03Z", actor: "system", action: "document_uploaded", target: "doc-shop" },
      { at: "2026-10-30T14:31:55Z", actor: "system", action: "image_brief_failed", target: null },
      { at: "2026-10-30T14:33:02Z", actor: "system", action: "image_brief_ok", target: null },
      { at: "2026-10-30T15:02:00Z", actor: "system", action: "consult_handoff_created", target: "consult-01" },
    ],
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
    sent_to_designers_at: "2026-10-29T03:05:00Z",
    transcript: [
      { role: "assistant", text: "Welcome! Tell me about your business.", at: "2026-10-29T02:40:00Z" },
      { role: "client", text: "Forge Fitness gym, bold promo graphic.", at: "2026-10-29T02:44:12Z" },
    ],
    documents: { "doc-acra": { filename: "ACRA-profile.pdf", status: "confirmed" } },
    looks: [{ id: "r1-a", url: art("Forge Fitness", "Final poster", "#1D2129", "#E8F0FF"), title: "Dark gym poster", brief: "High contrast headline", round: 2, selected: true, at: "2026-10-29T02:58:12Z" }],
    consult: null,
    decisions: [{ decision: "approve", at: "2026-10-29T03:04:00Z" }],
    outbox: [{ status: "Sent (demo)", to: "daniel@forgefit.example", subject: "With a designer", sent_at: "2026-10-29T03:04:05Z" }],
    audit: [
      { at: "2026-10-29T02:51:09Z", actor: "system", action: "document_uploaded", target: "doc-acra" },
      { at: "2026-10-29T02:58:12Z", actor: "client", action: "look_selected", target: "r1-a" },
      { at: "2026-10-29T03:04:00Z", actor: "staff:demo", action: "decision_approve", target: "r1-a" },
    ],
  },
  {
    id: "c-sample04",
    fields: {
      business_name: "Sample Bakery (demo)",
      business_type: "Bakery",
      industry: "Food & Beverage",
      business_website: "sample-bakery.example.test",
      contact_name: "Sam Lee",
      title_position: "Owner",
      email: "sam@sample-bakery.example.test",
      phone_number: "+65 6000 0004",
      design_preferences: "Cosy neighbourhood bakery, warm browns and cream",
      expected_annual_revenue: "SGD 250k",
      requirements_notes: "Weekend offer poster.",
    },
    images: [art("Sample Bakery", "Weekend offer", "#FFF3E0", "#9C6B2F")],
    reference_images: [],
    status: "awaiting_review",
    round: 1,
  },
];

// Mock traces carry no model ids: the staff UI never shows them.
const TRACES: Record<string, StepTrace[]> = {
  "c-kopi01": [
    { step: "read_document", ok: true, ms: 1840, cost_sgd: 0.0042, at: "2026-10-31T09:02:11Z" },
    { step: "translate", ok: true, ms: 620, cost_sgd: 0.0011, at: "2026-10-31T09:04:02Z" },
    { step: "image_brief", ok: true, ms: 2310, cost_sgd: 0.0056, at: "2026-10-31T09:07:44Z" },
    { step: "generate_image", ok: true, ms: 9420, cost_sgd: 0.0135, at: "2026-10-31T09:09:31Z" },
  ],
  "c-bloom02": [
    { step: "read_document", ok: true, ms: 2010, cost_sgd: 0.0048, at: "2026-10-30T14:20:11Z" },
    { step: "image_brief", ok: false, ms: 30500, cost_sgd: 0.0021, at: "2026-10-30T14:31:55Z" },
    { step: "image_brief", ok: true, ms: 2480, cost_sgd: 0.0059, at: "2026-10-30T14:33:02Z" },
    { step: "generate_image", ok: true, ms: 8810, cost_sgd: 0.0135, at: "2026-10-30T14:36:40Z" },
  ],
  "c-forge03": [
    { step: "read_document", ok: true, ms: 1760, cost_sgd: 0.0041, at: "2026-10-29T02:51:09Z" },
    { step: "image_brief", ok: true, ms: 2190, cost_sgd: 0.0054, at: "2026-10-29T02:55:37Z" },
    { step: "generate_image", ok: true, ms: 9100, cost_sgd: 0.0135, at: "2026-10-29T02:58:12Z" },
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
const SUBMITTED = ["2026-10-31T09:12:00Z", "2026-10-30T14:40:00Z", "2026-10-29T03:05:00Z", "2026-11-03T10:15:00Z"];

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
  // Clearly fake share-link + feedback demo data (Sample Bakery only).
  const sharesDb = new Map<string, ShareLink[]>();
  const shortlistDb = new Map<string, string[]>();
  const feedbackDb = new Map<string, FeedbackEntry[]>();
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
  const sharesFor = (cid: string): ShareLink[] => {
    let list = sharesDb.get(cid);
    if (!list) {
      list = [];
      sharesDb.set(cid, list);
    }
    return list;
  };
  const shortlistIds = (cid: string): string[] => shortlistDb.get(cid) || [];
  const shortlistDrafts = (cid: string): StudioDraft[] => {
    const ids = new Set(shortlistIds(cid));
    return draftsFor(cid).filter((d) => ids.has(d.id));
  };
  const knownClient = (cid: string) => db.some((x) => x.id === cid);
  const DAY = 86400000;

  // Seed Sample Bakery with two sent drafts, a shortlist, taps and two links.
  const seedSample = () => {
    const cid = "c-sample04";
    const sentAt = new Date(Date.now() - 2 * DAY).toISOString();
    const a = makeDraft(cid, "Sample Bakery", "post", 3, { run_id: "mock-run-sample" });
    const b = makeDraft(cid, "Sample Bakery", "post", 0, { run_id: "mock-run-sample" });
    a.sent_at = sentAt;
    b.sent_at = sentAt;
    draftsFor(cid).push(a, b);
    shortlistDb.set(cid, [a.id, b.id]);
    feedbackDb.set(cid, [
      { draft_id: a.id, kind: "heart", note: null, actor: "client:share", created_at: new Date(Date.now() - 30 * 3600000).toISOString() },
      { draft_id: b.id, kind: "changes", note: "Love the colours — please make the weekend offer headline bigger.", actor: "client:share", created_at: new Date(Date.now() - 26 * 3600000).toISOString() },
      { draft_id: b.id, kind: "reject", note: null, actor: "client:share", created_at: new Date(Date.now() - 25 * 3600000).toISOString() },
      { draft_id: a.id, kind: "approve", note: null, actor: "client:share", created_at: new Date(Date.now() - 5 * 3600000).toISOString() },
    ]);
    sharesDb.set(cid, [
      { id: "mock-share-live", expires_at: new Date(Date.now() + 6 * DAY).toISOString(), revoked_at: null, used_at: new Date(Date.now() - DAY).toISOString(), created_by: "staff:demo" },
      { id: "mock-share-old", expires_at: new Date(Date.now() - DAY).toISOString(), revoked_at: null, used_at: null, created_by: "staff:demo" },
    ]);
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
  const finalsDb = new Map<string, string[]>();
  const finalsFor = (cid: string): string[] => {
    let list = finalsDb.get(cid);
    if (!list) {
      list = [];
      finalsDb.set(cid, list);
    }
    return list;
  };
  const chosenLookFor = (cid: string): string => {
    const d = db.find((x) => x.id === cid);
    const looks = (d?.looks || []).filter((l) => l.url);
    const picked = looks.find((l) => l.selected);
    if (picked?.title) return picked.title;
    const short = shortlistDrafts(cid).filter((x) => x.url);
    if (short.length && short[0].style_title) return short[0].style_title;
    if (!looks.length) return "";
    const top = Math.max(...looks.map((l) => l.round ?? 0));
    return looks.find((l) => (l.round ?? 0) === top)?.title || "";
  };
  const designerRow = (cid: string): DesignerRow => {
    const d = db.find((x) => x.id === cid)!;
    const finals = finalsFor(cid);
    return {
      id: cid,
      business_name: d.fields.business_name || "",
      business_type: d.fields.business_type || "",
      industry: d.fields.industry || "",
      design_preferences: (d.fields as Record<string, unknown>).design_preferences as string || "",
      requirements_notes: (d.fields as Record<string, unknown>).requirements_notes as string || "",
      brand_colours: (d.fields as Record<string, unknown>).brand_colours as string || "",
      chosen_look: chosenLookFor(cid),
      final_images: [...finals],
      final_status: finals.length ? "Done" : "Pending final edit",
      sent_to_designers_at: d.sent_to_designers_at || null,
    };
  };
  const api = {
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
          sent_to_designers_at: d.sent_to_designers_at || null,
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
    sendToDesigners: (id: string): Promise<{ ok: boolean; id: string; sent_to_designers_at: string }> => {
      const d = db.find((x) => x.id === id);
      if (!d) return Promise.reject(new Error("HTTP 404"));
      if (!d.sent_to_designers_at) d.sent_to_designers_at = new Date().toISOString();
      return wait({ ok: true, id, sent_to_designers_at: d.sent_to_designers_at });
    },
    designer: (): Promise<DesignerRow[]> =>
      wait(
        db
          .filter((d) => d.sent_to_designers_at)
          .map((d) => designerRow(d.id))
          .sort((a, b) => Number(a.final_status === "Done") - Number(b.final_status === "Done")),
      ),
    downloadZip: async (cid: string): Promise<Blob> => {
      const d = db.find((x) => x.id === cid);
      if (!d || !d.sent_to_designers_at) return Promise.reject(new Error("HTTP 404"));
      const urls = [...d.images, ...(d.looks || []).map((l) => l.url), ...draftsFor(cid).map((x) => x.url)];
      const files: { name: string; data: Uint8Array }[] = [];
      let n = 0;
      for (const u of urls) {
        if (!u) continue;
        n += 1;
        const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
        files.push({ name: `image-${n}.svg`, data: buf });
      }
      return new Blob([zipStore(files) as unknown as BlobPart], { type: "application/zip" });
    },
    uploadFinals: async (cid: string, files: File[]): Promise<FinalUploadResult> => {
      if (!db.some((x) => x.id === cid)) return Promise.reject(new Error("HTTP 404"));
      if (files.length > 10) return Promise.reject(new Error("Too many files. Upload up to 10 at a time."));
      const urls: string[] = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = "";
        for (const b of bytes) bin += String.fromCharCode(b);
        urls.push(`data:${f.type || "image/png"};base64,${btoa(bin)}`);
      }
      finalsFor(cid).push(...urls);
      return wait({ ok: true, id: cid, final_images: [...finalsFor(cid)] });
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
    createShare: (cid: string, days = 7): Promise<ShareCreated> => {
      if (!knownClient(cid)) return Promise.reject(new Error("HTTP 404"));
      if (!Number.isInteger(days) || days < 1 || days > 30) {
        return Promise.reject(new Error("Link lifetime must be between 1 and 30 days."));
      }
      seq += 1;
      const id = `mock-share-${seq}`;
      const expiresAt = new Date(Date.now() + days * DAY).toISOString();
      sharesFor(cid).push({ id, expires_at: expiresAt, revoked_at: null, used_at: null, created_by: "staff:demo" });
      return wait({ id, url: `https://example.test/share#t=mock-token-${seq}`, expires_at: expiresAt });
    },
    listShares: (cid: string): Promise<ShareLink[]> => {
      if (!knownClient(cid)) return Promise.reject(new Error("HTTP 404"));
      return wait(sharesFor(cid));
    },
    revokeShare: (cid: string, tokenId: string): Promise<{ id: string; revoked_at: string }> => {
      if (!knownClient(cid)) return Promise.reject(new Error("HTTP 404"));
      const row = sharesFor(cid).find((s) => s.id === tokenId);
      if (!row) return Promise.reject(new Error("HTTP 404"));
      row.revoked_at = row.revoked_at || new Date().toISOString();
      return wait({ id: row.id, revoked_at: row.revoked_at });
    },
    shortlist: (cid: string): Promise<ShortlistView> => {
      if (!knownClient(cid)) return Promise.reject(new Error("HTTP 404"));
      return wait({ drafts: shortlistDrafts(cid), feedback: feedbackDb.get(cid) || [] });
    },
    setShortlist: (cid: string, draftId: string, add: boolean): Promise<{ drafts: StudioDraft[] }> => {
      if (!knownClient(cid)) return Promise.reject(new Error("HTTP 404"));
      if (!draftsFor(cid).some((d) => d.id === draftId)) return Promise.reject(new Error("HTTP 404"));
      const ids = new Set(shortlistIds(cid));
      if (add) ids.add(draftId);
      else ids.delete(draftId);
      shortlistDb.set(cid, [...ids]);
      return wait({ drafts: shortlistDrafts(cid) });
    },
  };
  seedSample();
  return api;
}
