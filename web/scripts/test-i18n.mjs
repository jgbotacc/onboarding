// [i18n] Front-end-only checks for src/i18n (key parity) and src/looks/picker.ts. Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
const en = (await server.ssrLoadModule("/src/i18n/en.ts")).default;
const zh = (await server.ssrLoadModule("/src/i18n/zh.ts")).default;
const ms = (await server.ssrLoadModule("/src/i18n/ms.ts")).default;
const ta = (await server.ssrLoadModule("/src/i18n/ta.ts")).default;
const { t } = await server.ssrLoadModule("/src/i18n/index.ts");
const { canUsePicked, hasLookOptions, isPicked, roundInfo, togglePicked } = await server.ssrLoadModule("/src/looks/picker.ts");
const { MAX_ROUNDS } = await server.ssrLoadModule("/src/types.ts");
let n = 0;
const pass = (name, cond) => (n++, assert.ok(cond, name));

try {
  // Every en key exists and is non-empty in zh, ms and ta.
  const keys = Object.keys(en);
  pass("en has keys", keys.length > 0);
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    for (const k of keys) {
      n++;
      assert.ok(typeof dict[k] === "string" && dict[k].trim() !== "", `${name}.${k} missing or empty`);
    }
  }

  // No dictionary has extra keys beyond en.
  for (const [name, dict] of [["zh", zh], ["ms", ms], ["ta", ta]]) {
    const extra = Object.keys(dict).filter((k) => !(k in en));
    n++;
    assert.deepEqual(extra, [], `${name} has extra keys: ${extra.join(", ")}`);
  }

  // Toggle: picking adds, picking again removes; others are kept.
  n++;
  assert.deepEqual(togglePicked([], "a"), ["a"], "toggle adds to empty");
  n++;
  assert.deepEqual(togglePicked(["a"], "a"), [], "toggle removes picked");
  n++;
  assert.deepEqual(togglePicked(["a"], "b"), ["a", "b"], "toggle keeps others");
  n++;
  assert.deepEqual(togglePicked(["a", "b"], "a"), ["b"], "toggle removes one of many");
  const before = ["a"];
  togglePicked(before, "b");
  pass("toggle does not mutate input", JSON.stringify(before) === JSON.stringify(["a"]));
  pass("isPicked true", isPicked(["a", "b"], "b"));
  pass("isPicked false", !isPicked(["a"], "b"));

  // Can submit ("Use these" enabled) only with at least one pick.
  pass("cannot submit with none picked", canUsePicked([]) === false);
  pass("can submit with one picked", canUsePicked(["a"]) === true);
  pass("can submit with several picked", canUsePicked(["a", "b"]) === true);

  // Round label: 1-based "Round {round} of {max}" with sane fallbacks.
  n++;
  assert.deepEqual(roundInfo({ round: 1, max_rounds: 3, options: [] }), { round: 1, max: 3 }, "round 1 of 3");
  n++;
  assert.deepEqual(roundInfo({ round: 2, max_rounds: 3, options: [] }).max, 3, "round 2 max");
  pass("bad round falls back to 1", roundInfo({ round: 0, max_rounds: 3, options: [] }).round === 1);
  pass("bad max falls back to MAX_ROUNDS", roundInfo({ round: 1, max_rounds: 0, options: [] }).max === MAX_ROUNDS);
  pass("max never below round", roundInfo({ round: 5, max_rounds: 3, options: [] }).max === 5);
  {
    const { round, max } = roundInfo({ round: 2, max_rounds: 3, options: [] });
    n++;
    assert.equal(t("en", "looks.round", { round, max }), `Round ${round} of ${max}`, "en round label");
  }

  // Consult after round 3: the last round (round >= max) hands off instead of showing more looks.
  pass("MAX_ROUNDS is 3", MAX_ROUNDS === 3);
  const last = (round) => {
    const { round: r, max: m } = roundInfo({ round, max_rounds: MAX_ROUNDS, options: [] });
    return r >= m;
  };
  pass("round 1 continues", last(1) === false);
  pass("round 2 continues", last(2) === false);
  pass("round 3 consults", last(3) === true);
  pass("no look options without options", hasLookOptions({ round: 1, max_rounds: 3, options: [] }) === false);

  console.log(`i18n: ${n} checks passed`);
} finally {
  await server.close();
}
