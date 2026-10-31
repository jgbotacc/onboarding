import { ApiResponse, MAX_ROUNDS } from "./types";

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
}

export function createMock() {
  const s: MockState = { registered: false, missing: [], round: 0, status: "registering" };

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
      `${prefix}Here are round ${s.round} concepts based on your design direction. Do they look right?`,
      [0, 1, 2].map((i) => placeholder(s.round, i)),
    );
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
        s.missing = ["Contact email or phone"];
        s.status = "missing_info";
        return resp(
          `I've read your document and registered your business${jpgs ? ` along with ${jpgs} reference image(s)` : ""}. One mandatory detail is missing: please send your contact email or phone number.`,
        );
      }
      return resp(`Got ${files.length} more file(s). I'll use them in the next round.`);
    },
    chat(text: string): ApiResponse {
      if (!s.registered) return resp("To get started, please upload a PDF with your business details, plus any JPG reference images.");
      if (s.status === "missing_info") {
        if (text.includes("@") || /\d{6,}/.test(text.replace(/[\s+-]/g, ""))) {
          s.missing = [];
          s.status = "generating";
          return generate("Thanks, your contact details are saved. ");
        }
        return resp("That doesn't look like an email or phone number. Could you send your contact email or phone?");
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
    chat: (t: string) => delay(handlers.chat(t)),
    review: (a: boolean, fb: string) => delay(handlers.review(a, fb)),
  };
}
