// Share-link mock (demo data only). Used on ?mock=1 so the page renders without a backend.
// Clearly fake: Sample Bakery, placeholder art, example.test contact.
import type { FeedbackKind, ShareClient, ShareDecided, ShareDraft, ShareState } from "./api";
import { ShareLinkError } from "./api";

function art(title: string, sub: string, bg: string, fg: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">` +
    `<rect width="1080" height="1080" fill="${bg}"/>` +
    `<rect x="98" y="130" width="884" height="367" rx="8" fill="${fg}" fill-opacity=".14"/>` +
    `<circle cx="540" cy="313" r="130" fill="${fg}" fill-opacity=".5"/>` +
    `<text x="540" y="626" font-family="system-ui,sans-serif" font-size="72" font-weight="600" text-anchor="middle" fill="${fg}">${esc(title)}</text>` +
    `<text x="540" y="694" font-family="system-ui,sans-serif" font-size="42" text-anchor="middle" fill="${fg}" fill-opacity=".75">${esc(sub)}</text>` +
    `<text x="540" y="996" font-family="system-ui,sans-serif" font-size="30" text-anchor="middle" fill="${fg}" fill-opacity=".6">Sample image</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

interface Tap {
  draft_id: string;
  kind: FeedbackKind;
  note: string | null;
}

const DRAFTS: ShareDraft[] = [
  { id: "mock-share-draft-1", url: art("Sample Bakery", "Weekend offer · A", "#FFF3E0", "#9C6B2F"), title: "Weekend offer · A", liked: true },
  { id: "mock-share-draft-2", url: art("Sample Bakery", "Weekend offer · B", "#F6E8EE", "#8A3B5C"), title: "Weekend offer · B", liked: false },
  { id: "mock-share-draft-3", url: art("Sample Bakery", "Weekend offer · C", "#EAF2EA", "#2F6B45"), title: "Weekend offer · C", liked: false },
];

const CONTACT = "sam@sample-bakery.example.test";

export function createShareMock(): ShareClient {
  const liked = new Set<string>(["mock-share-draft-1"]);
  const taps: Tap[] = [];

  const decided = (): ShareDecided | null => {
    const approve = [...taps].reverse().find((t) => t.kind === "approve");
    if (approve) return { draft_id: approve.draft_id, kind: "approve" };
    const changes = [...taps].reverse().find((t) => t.kind === "changes");
    if (changes) return { draft_id: changes.draft_id, kind: "changes" };
    return null;
  };

  const snapshot = (): ShareState => ({
    business_name: "Sample Bakery",
    drafts: DRAFTS.map((d) => ({ ...d, liked: liked.has(d.id) })),
    shortlist: DRAFTS.filter((d) => liked.has(d.id)).map((d) => d.id),
    decided: decided(),
  });

  const wait = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(structuredClone(v)), 200));

  // Special demo tokens so the link states are viewable without a backend:
  // #t=expired reads 410, #t=revoked reads 404; any other token opens Sample Bakery.
  const check = (token: string) => {
    if (token === "expired") throw new ShareLinkError(410, "This link has expired. Please ask our team for a new one.");
    if (token === "revoked" || token === "unknown") {
      throw new ShareLinkError(404, "This link is no longer valid. Please ask our team for a new one.");
    }
  };

  return {
    mock: true,
    get: (token) => {
      try {
        check(token);
      } catch (e) {
        return Promise.reject(e);
      }
      return wait(snapshot());
    },
    feedback: (token, body) => {
      try {
        check(token);
      } catch (e) {
        return Promise.reject(e);
      }
      if (!DRAFTS.some((d) => d.id === body.draft_id)) return Promise.reject(new Error("HTTP 404 Draft not found."));
      if (body.kind === "changes") {
        const note = (body.note || "").trim();
        if (!note) return Promise.reject(new Error("Please add a short note about what to change."));
        if (note.length > 500) return Promise.reject(new Error("Please keep your note under 500 characters."));
        taps.push({ draft_id: body.draft_id, kind: "changes", note });
      } else {
        taps.push({ draft_id: body.draft_id, kind: body.kind, note: null });
        if (body.kind === "heart") liked.add(body.draft_id);
        if (body.kind === "reject") liked.delete(body.draft_id);
      }
      void CONTACT;
      return wait({ ok: true as const, shortlist: snapshot().shortlist });
    },
  };
}
