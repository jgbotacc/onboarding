// Mock staff API (demo data only). Used on ?mock=1 or when /api/staff/* is unreachable.
import type { DecisionBody, DecisionResult, StaffDetail, StaffRow } from "./types";

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
      art("Bloom & Stem", "Round 2, option A", "#F6E8EE", "#8A3B5C"),
      art("Bloom & Stem", "Round 2, option B", "#EAF2EA", "#2F6B45"),
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
    images: [art("Forge Fitness", "Round 3", "#1D2129", "#E8F0FF")],
    reference_images: [art("Reference", "Competitor poster", "#E5E6EB", "#1D2129"), art("Reference", "Brand colours", "#E8F0FF", "#1664FF")],
    status: "handed_off",
    round: 3,
  },
];

const SUBMITTED = ["2026-10-31T09:12:00Z", "2026-10-30T14:40:00Z", "2026-10-29T03:05:00Z"];

const STATUS_AFTER: Record<string, string> = { approve: "approved", reject: "rejected", more_info: "needs_info" };

export function createStaffMock() {
  const db = DETAILS.map((d) => ({ ...d }));
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
  };
}
