// Contract checks for the client adapter (Docs/UI-API-CONTRACT.md). Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";

// Minimal browser globals used by src/api.ts (realClient path only; no window needed).
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
};
globalThis.document = { documentElement: { lang: "en" } };

const calls = [];
const okReply = { reply: "hi", status: "registering", images: [], missing: [], round: 0 };
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), init: init || {} });
  return { ok: true, json: async () => ({ ...okReply }) };
};

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const api = await server.ssrLoadModule("/src/api.ts");
  const { normalizeChatReply, realClient, storeLang } = api;

  // PRD response names map onto the contract shape.
  const fromConfirm = normalizeChatReply({
    reply: "r", status: "confirm_details", images: [], missing: [], round: 0,
    confirm: { docId: "d1", filename: "a.pdf", fields: [{ key: "business_name", label: "Business name", value: "ABC" }] },
  });
  pass("confirm.fields -> extracted", fromConfirm.extracted?.[0]?.field === "business_name" && fromConfirm.extracted[0].value === "ABC");

  const fromTitle = normalizeChatReply({
    reply: "r", status: "x", images: [], missing: [], round: 1,
    looks: { round: 1, max_rounds: 3, options: [{ id: "r1-a", url: "https://x/y.png", title: "Warm look" }] },
  });
  pass("title -> alt", fromTitle.looks.options[0].alt === "Warm look");

  const fromRetake = normalizeChatReply({ reply: "r", status: "x", images: [], missing: [], round: 0, retake: true, retake_reason: "blurry" });
  pass("retake+reason -> object", fromRetake.retake?.reason === "blurry");
  const fromReasonOnly = normalizeChatReply({ reply: "r", status: "x", images: [], missing: [], round: 0, retake_reason: "cropped" });
  pass("retake_reason alone -> object", fromReasonOnly.retake?.reason === "cropped");

  // step/status fallback.
  pass("step falls back to status", normalizeChatReply({ reply: "", status: "missing_info", images: [], missing: [], round: 0 }).step === "missing_info");
  pass("status falls back to step", normalizeChatReply({ reply: "", step: "accepted", images: [], missing: [], round: 0 }).status === "accepted");

  // Contract shape passes through.
  const full = normalizeChatReply({
    reply: "pick", lang: "zh", step: "choosing_look", status: "choosing_look", images: [], missing: [], round: 1,
    looks: { round: 1, max_rounds: 3, options: [{ id: "a", url: "u", alt: "d" }] },
    extracted: [{ field: "business_name", label: "Business name", value: "ABC" }],
    retake: { reason: "blurry" },
    consult: { status: "pending_approval", submitted: { "Business name": "ABC" }, next_steps: ["Agree a style"] },
  });
  pass("contract looks kept", full.looks.options[0].alt === "d");
  pass("contract extracted kept", full.extracted[0].field === "business_name");
  pass("contract retake kept", full.retake.reason === "blurry");
  pass("contract consult kept", full.consult.status === "pending_approval");

  // Every request sends lang in the body plus x-lang (and x-session-secret).
  storeLang("zh");
  const client = realClient("s1", "sec1");
  for (const k of ["pickLooks", "skipLooks", "confirmExtracted", "removeUpload", "trace", "setLang"]) {
    pass("client has " + k, typeof client[k] === "function");
  }
  calls.length = 0;
  await client.chat("hello");
  await client.form({ business_name: "ABC" });
  await client.review(true, "");
  await client.pickLooks(["r1-a", "r1-b"]);
  await client.skipLooks();
  await client.confirmExtracted({ business_name: "ABC" });
  await client.removeUpload();
  await client.trace("mic", true, 120);
  const byPath = Object.fromEntries(calls.map((c) => [c.url, c]));
  const bodies = {};
  for (const [url, c] of Object.entries(byPath)) bodies[url] = JSON.parse(c.init.body);
  for (const url of ["/api/chat", "/api/form", "/api/review", "/api/looks/pick", "/api/looks/skip", "/api/extracted/confirm", "/api/upload", "/api/trace"]) {
    pass(url + " called", !!byPath[url]);
  }
  for (const [url, c] of Object.entries(byPath)) {
    pass(url + " x-lang", c.init.headers["x-lang"] === "zh");
    pass(url + " secret", c.init.headers["x-session-secret"] === "sec1");
  }
  for (const [url, b] of Object.entries(bodies)) {
    if (url === "/api/upload") continue; // DELETE body checked below (method + lang)
    pass(url + " body lang", b.lang === "zh" && b.sessionId === "s1");
  }
  pass("chat body", bodies["/api/chat"].text === "hello");
  pass("form body", bodies["/api/form"].fields.business_name === "ABC");
  pass("review body", bodies["/api/review"].accepted === true);
  pass("pick body", JSON.stringify(bodies["/api/looks/pick"].picked_ids) === JSON.stringify(["r1-a", "r1-b"]));
  pass("confirm body", bodies["/api/extracted/confirm"].fields.business_name === "ABC");
  pass("removeUpload DELETE", byPath["/api/upload"].init.method === "DELETE" && bodies["/api/upload"].lang === "zh");
  pass("trace body", bodies["/api/trace"].kind === "mic" && bodies["/api/trace"].ok === true && bodies["/api/trace"].ms === 120);

  // Uploads carry a lang field plus x-lang.
  if (typeof File !== "undefined" && typeof FormData !== "undefined") {
    calls.length = 0;
    const f = new File(["x"], "doc.pdf", { type: "application/pdf" });
    await client.upload([f]);
    const up = calls[0];
    pass("upload path", up.url === "/api/upload");
    pass("upload x-lang", up.init.headers["x-lang"] === "zh");
    pass("upload lang field", up.init.body.get("lang") === "zh" && up.init.body.get("sessionId") === "s1");
  }

  // trace never throws (network failure or error status).
  globalThis.fetch = async () => { throw new Error("down"); };
  await client.trace("listen", false, 5);
  pass("trace swallows network error", true);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({}) });
  await client.trace("listen", false, 5);
  pass("trace ignores error status", true);

  console.log(`api-contract: ${n} checks passed`);
} finally {
  await server.close();
}
