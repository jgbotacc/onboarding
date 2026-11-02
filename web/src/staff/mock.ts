// Mock staff API (demo data only). Used on ?mock=1 or when /api/staff/* is unreachable.
import type { Consult, DecisionBody, DecisionResult, RejectedLookRound, StaffDetail, StaffMetrics, StaffRow, StepTrace } from "./types";

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

export function createStaffMock() {
  const db = DETAILS.map((d) => ({ ...d, traces: TRACES[d.id] || [] }));
  const consultDb = CONSULTS.map((c) => ({ ...c }));
  const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 300));
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
  };
}
