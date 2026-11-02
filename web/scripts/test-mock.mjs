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

  // A fresh mock session starts on the sample gallery (pick_poster, round 0).
  {
    storage.set("onboardingLang", "en");
    const m = createMock();
    const st = m.start;
    pass("start present", !!st);
    pass("start pick_poster", st.step === "pick_poster" && st.status === "pick_poster");
    pass("start round 0", st.round === 0);
    pass("start reply", st.reply === t("en", "mock.galleryStart"));
    pass("start 3 samples", Array.isArray(st.looks?.options) && st.looks.options.length === 3);
    pass(
      "start sample ids/urls",
      st.looks.options.every((o, i) => o.id === `sample-${i + 1}` && o.url.endsWith(`samples/sample-${i + 1}.jpg`)),
    );
    pass(
      "start sample alts",
      JSON.stringify(st.looks.options.map((o) => o.alt)) ===
        JSON.stringify([t("en", "mock.galleryAlt1"), t("en", "mock.galleryAlt2"), t("en", "mock.galleryAlt3")]),
    );
    const resumed = createMock({ resumed: true });
    pass("resumed has no start", resumed.start === undefined);
  }

  // Pick -> Nice pick, then the four questions in order; headline may skip; email hands to looks round 1.
  {
    const m = createMock();
    const p = await m.pickLooks(["sample-1"]);
    pass("pick missing_info", p.step === "missing_info" && p.status === "missing_info");
    pass(
      "pick nice plus business q",
      p.reply === t("en", "mock.galleryPicked") + "\n" + t("en", "mock.qBusiness"),
    );
    pass(
      "pick missing four",
      JSON.stringify(p.missing) === JSON.stringify(["Business name", "Poster headline", "Contact name", "Email"]),
    );
    const q2 = await m.chat("Acme Pte Ltd");
    pass("business -> headline q", q2.step === "missing_info" && q2.reply === t("en", "mock.qHeadline"));
    pass("headline missing three", q2.missing.length === 3 && q2.missing[0] === "Poster headline");
    const q3 = await m.chat("skip");
    pass("headline skip -> contact q", q3.reply === t("en", "mock.qContact"));
    pass("contact missing two", q3.missing.length === 2 && q3.missing[0] === "Contact name");
    const q4 = await m.chat("Jane Lee");
    pass("contact -> email q", q4.reply === t("en", "mock.qEmail"));
    pass("email missing one", q4.missing.length === 1 && q4.missing[0] === "Email");
    const h = await m.chat("jane@acme.sg");
    pass("email -> awaiting_review round 1", h.step === "awaiting_review" && h.status === "awaiting_review");
    pass("handover looks round 1", h.round === 1 && h.looks?.round === 1 && h.looks.options.length === 3);
    const done = await m.pickLooks([h.looks.options[0].id]);
    pass("handover pick accepted", done.step === "accepted" && done.status === "accepted");
  }

  // Chat ids ("1", "2 and 3", "all") also count as a gallery pick.
  {
    const m1 = createMock();
    const r1 = await m1.chat("1");
    pass("chat 1 picks", r1.step === "missing_info" && r1.reply.includes(t("en", "mock.galleryPicked")));
    const m2 = createMock();
    const r2 = await m2.chat("2 and 3");
    pass("chat 2 and 3 picks", r2.step === "missing_info" && r2.reply.includes(t("en", "mock.qBusiness")));
    const m3 = createMock();
    const r3 = await m3.chat("all");
    pass("chat all picks", r3.step === "missing_info");
  }

  // An upload mid-questions uses the existing upload path; confirming resumes the questions.
  {
    const m = createMock();
    await m.pickLooks(["sample-2"]);
    const u = await m.upload([pdf()]);
    pass("questions upload confirm_details", u.step === "confirm_details" && (u.extracted?.length ?? 0) > 0);
    const c = await m.confirmExtracted({});
    pass("confirm resumes at headline", c.step === "missing_info" && c.reply === t("en", "mock.qHeadline"));
    const c2 = await m.chat("20% off all coffee this week");
    pass("headline answers and hands over", c2.step === "awaiting_review" && c2.round === 1);
  }

  // Gallery skip (skipLooks or chat "skip") -> need_document, then the classic document flow.
  {
    const m = createMock();
    const sk = await m.skipLooks();
    pass("skip need_document", sk.step === "need_document" && sk.status === "need_document");
    pass("skip reply", sk.reply === t("en", "mock.gallerySkip"));
    const up = await m.upload([pdf()]);
    pass("post-skip upload works", up.step === "confirm_details");
    const m2 = createMock();
    const sk2 = await m2.chat("skip");
    pass("chat skip need_document", sk2.step === "need_document" && sk2.reply === t("en", "mock.gallerySkip"));
    const m3 = createMock();
    await m3.skipLooks();
    const typed = await m3.chat("Acme Pte Ltd, Jane Lee, jane@acme.sg");
    pass("typed details -> looks round 1", typed.step === "choosing_look" && typed.looks?.round === 1);
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
