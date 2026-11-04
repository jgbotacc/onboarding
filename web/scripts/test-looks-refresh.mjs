// Polling merge for staff-sent looks (picker refresh) + "Show me new ones" button. Run: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => void storage.set(k, String(v)),
  removeItem: (k) => void storage.delete(k),
};
globalThis.document = { documentElement: { lang: "en" } };

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));
try {
  const { mergeLooks, mergeSuggested, newLookOptions } = await server.ssrLoadModule("/src/looks/refresh.ts");
  const api = await server.ssrLoadModule("/src/api.ts");

  const opt = (id) => ({ id, url: "u-" + id, alt: id });
  const looks = (ids) => ({ round: 1, max_rounds: 3, options: ids.map(opt) });

  // Unseen ids are appended; already-shown ids are kept once.
  pass("new ids found", JSON.stringify(newLookOptions([{ id: "a" }], [opt("a"), opt("b")]).map((o) => o.id)) === JSON.stringify(["b"]));
  pass("no ids when all shown", newLookOptions([{ id: "a" }], [opt("a")]).length === 0);
  const merged = mergeLooks(looks(["a"]), looks(["a", "b"]));
  pass("merge appends unseen", !!merged && JSON.stringify(merged.options.map((o) => o.id)) === JSON.stringify(["a", "b"]));
  pass("merge null when nothing new", mergeLooks(looks(["a"]), looks(["a"])) === null);
  pass("merge null on missing looks", mergeLooks(looks(["a"]), null) === null);

  // Same for suggested_looks.
  const sug = mergeSuggested([{ id: "s1", url: "u", alt: "s" }], [{ id: "s1", url: "u", alt: "s" }, { id: "s2", url: "v", alt: "t" }]);
  pass("suggested appends unseen", !!sug && sug.length === 2 && sug[1].id === "s2");
  pass("suggested null when nothing new", mergeSuggested([{ id: "s1", url: "u", alt: "s" }], [{ id: "s1", url: "u", alt: "s" }]) === null);
  pass("suggested seeds from empty", (mergeSuggested(null, [{ id: "s1", url: "u", alt: "s" }]) || []).length === 1);

  // refresh() reuses the resume call: POST /api/session with the session secret.
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init || {} });
    return {
      ok: true,
      json: async () => ({
        reply: "",
        status: "awaiting_review",
        images: [],
        missing: [],
        round: 1,
        looks: { round: 1, max_rounds: 3, options: [{ id: "r1-c", url: "u", title: "New" }] },
        suggested_looks: [{ id: "s1", url: "v", title: "Staff pick" }],
      }),
    };
  };
  const client = api.realClient("s1", "sec1");
  pass("client has refresh", typeof client.refresh === "function");
  const r = await client.refresh();
  pass("refresh hits /api/session", calls.length === 1 && calls[0].url === "/api/session");
  const body = JSON.parse(calls[0].init.body);
  pass("refresh sends secret", body.sessionId === "s1" && body.sessionSecret === "sec1" && calls[0].init.headers["x-session-secret"] === "sec1");
  pass("refresh normalizes looks", r.looks.options[0].id === "r1-c" && r.looks.options[0].alt === "New");
  pass("refresh keeps suggested", r.suggested_looks[0].id === "s1");

  // Skip button: "Show me new ones" on earlier rounds, consult label on the last round; both send skip.
  const en = (await server.ssrLoadModule("/src/i18n/en.ts")).default;
  const zh = (await server.ssrLoadModule("/src/i18n/zh.ts")).default;
  const ms = (await server.ssrLoadModule("/src/i18n/ms.ts")).default;
  const ta = (await server.ssrLoadModule("/src/i18n/ta.ts")).default;
  pass("en button label", en["looks.skipNew"] === "Show me new ones");
  pass("en consult label", en["looks.consult"] === "None of these, talk to our team");
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    pass(`${name} button label translated`, typeof dict["looks.skipNew"] === "string" && dict["looks.skipNew"].trim() !== "" && dict["looks.skipNew"] !== en["looks.skipNew"]);
  }
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    pass(`${name} consult label translated`, typeof dict["looks.consult"] === "string" && dict["looks.consult"].trim() !== "" && dict["looks.consult"] !== en["looks.consult"]);
  }
  for (const [name, dict] of [["en", en], ["zh", zh], ["ms", ms], ["ta", ta]]) {
    pass(`${name} button label has no skip`, !/skip/i.test(dict["looks.skipNew"]));
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const pickerSrc = readFileSync(join(here, "../src/looks/LooksPicker.tsx"), "utf8");
  pass("picker has new-ones button", pickerSrc.includes("looks.skipNew"));
  pass("picker has consult label", pickerSrc.includes("looks.consult"));
  pass("picker button sends skip", pickerSrc.includes("client.skipLooks()"));
  pass("picker swaps label on last round", /isLastRound\s*\?\s*"looks\.consult"\s*:\s*"looks\.skipNew"/.test(pickerSrc));
  pass("picker keeps button on last round", !/!isLastRound\s*&&/.test(pickerSrc));

  console.log(`looks-refresh: ${n} checks passed`);
} finally {
  await server.close();
}
