// Contract checks for ?mock=1 (Docs/UI-API-CONTRACT.md). Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// Minimal browser globals used by src/mock.ts (localStorage lang + File).
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
};

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const src = readFileSync(join(root, "src", "mock.ts"), "utf8");
  pass("mock imports t() from i18n", /from\s+["']\.\/i18n["']/.test(src) && /\bt\s*\(/.test(src));

  const { createMock } = await server.ssrLoadModule("/src/mock.ts");
  const { t } = await server.ssrLoadModule("/src/i18n/index.ts");
  pass("createMock exported", typeof createMock === "function");

  const pdf = (name = "registration.pdf") => new File(["%PDF fake"], name, { type: "application/pdf" });
  const NRIC = /^[STFGM]\d{7}[A-Z]$/;

  // Upload of a pdf returns extracted fields (no NRIC) with step confirm_details.
  storage.set("onboardingLang", "en");
  {
    const m = createMock();
    const r = await m.upload([pdf()]);
    pass("pdf step confirm_details", r.step === "confirm_details" && r.status === "confirm_details");
    pass("pdf extracted non-empty", Array.isArray(r.extracted) && r.extracted.length > 0);
    pass("pdf extracted shape", r.extracted.every((f) => f.field && f.label && typeof f.value === "string"));
    pass("pdf no nric field", r.extracted.every((f) => !/^(nric|fin)$/i.test(f.field)));
    pass("pdf no nric value", r.extracted.every((f) => !NRIC.test(String(f.value).trim())));
    pass("pdf reply lang", r.lang === "en" && typeof r.reply === "string" && r.reply.length > 0);
  }

  // A file named with blurry in it returns retake {reason:"blurry"}.
  {
    const m = createMock();
    const r = await m.upload([new File(["x"], "my-blurry-scan.jpg", { type: "image/jpeg" })]);
    pass("blurry retake", r.retake?.reason === "blurry");
    const m2 = createMock();
    const r2 = await m2.upload([pdf("BLURRY-doc.pdf")]);
    pass("blurry pdf retake wins", r2.retake?.reason === "blurry");
  }

  // After confirm and the design question, looks rounds of 3 placeholder options with alt text.
  {
    const m = createMock();
    await m.upload([pdf()]);
    const afterConfirm = await m.confirmExtracted({ business_name: "ABC Pte Ltd" });
    pass("confirm asks design question", typeof afterConfirm.reply === "string" && afterConfirm.reply.length > 0);
    const looks1 = await m.chat("warm, minimal, brown and cream");
    pass("looks round 1 step", looks1.step === "choosing_look");
    pass("looks round 1 shape", looks1.looks?.round === 1 && looks1.looks?.max_rounds === 3);
    pass("looks 3 options", Array.isArray(looks1.looks?.options) && looks1.looks.options.length === 3);
    pass(
      "looks options have id/url/alt",
      looks1.looks.options.every((o) => o.id && o.url && o.alt),
    );

    // Pick returns accepted.
    const picked = await m.pickLooks([looks1.looks.options[0].id]);
    pass("pick accepted", picked.step === "accepted" && picked.status === "accepted");
  }

  // Skip gives the next round; after the 3rd skip return consult with submitted and next_steps.
  {
    const m = createMock();
    await m.upload([pdf()]);
    await m.confirmExtracted({ business_name: "ABC Pte Ltd" });
    const looks1 = await m.chat("warm, minimal");
    pass("skip-flow starts round 1", looks1.looks?.round === 1);
    const s1 = await m.skipLooks();
    pass("skip 1 next round", s1.looks?.round === 2 && s1.step === "choosing_look");
    const s2 = await m.skipLooks();
    pass("skip 2 next round", s2.looks?.round === 3 && s2.step === "choosing_look");
    const s3 = await m.skipLooks();
    pass("skip 3 consult", !!s3.consult && s3.consult.status === "pending_approval");
    pass("consult submitted", !!s3.consult.submitted && Object.keys(s3.consult.submitted).length > 0);
    pass("consult next_steps", Array.isArray(s3.consult.next_steps) && s3.consult.next_steps.length > 0);
  }

  // Replies follow the chosen lang using t().
  {
    storage.set("onboardingLang", "zh");
    const m = createMock();
    const r = await m.upload([pdf()]);
    pass("zh lang field", r.lang === "zh");
    pass("zh reply translated", r.reply === t("zh", "mock.confirmAsk"));
    const altZh = (await m.confirmExtracted({ business_name: "ABC" }).then(() => m.chat("暖色"))) || null;
    pass("zh looks alt translated", altZh.looks.options.every((o) => o.alt && !/^Warm|^Bold|^Soft/.test(o.alt)));
    storage.set("onboardingLang", "en");
  }

  // trace just resolves.
  {
    const m = createMock();
    pass("trace is function", typeof m.trace === "function");
    await m.trace("mic", true, 120);
    pass("trace resolves", true);
  }

  console.log(`mock-contract: ${n} checks passed`);
} finally {
  await server.close();
}
