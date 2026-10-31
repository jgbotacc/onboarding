// [field-validation] Front-end-only checks for src/validation.ts. Run: npm test
import assert from "node:assert/strict";
import { createServer } from "vite";

const server = await createServer({ configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
const { validateField, parseAmount } = await server.ssrLoadModule("/src/validation.ts");
let n = 0;
const ok = (key, v) => (n++, assert.equal(validateField(key, v), null, `${key}=${JSON.stringify(v)} should pass`));
const bad = (key, v) => {
  n++;
  const r = validateField(key, v);
  assert.ok(r, `${key}=${JSON.stringify(v)} should fail`);
  assert.ok(r.message && r.example, `${key} failure needs message + example`);
};

try {
  // Revenue: numbers, shorthand, currencies, ranges, words.
  const amounts = {
    "five thousand dollars": 5000, "$5k": 5000, "50,000": 50000, "1.2m": 1200000, "SGD 300k": 300000,
    "S$250k": 250000, "100k-200k": 100000, "about two million": 2000000, "$5,000 a month": 5000,
    "two hundred and fifty thousand": 250000, "a million": 1000000, "S$250,000 per year": 250000, "120000": 120000,
  };
  for (const [t, want] of Object.entries(amounts)) {
    n++;
    assert.equal(parseAmount(t), want, t);
    ok("expected_annual_revenue", t);
  }
  ["cat", "lots", "k", "m", "dunno", "five cats", "$$$"].forEach((t) => bad("expected_annual_revenue", t));

  ["Cafe", "Retail shop", "IT consultancy", "F&B"].forEach((t) => ok("business_type", t));
  ["123", "!!!", "x", "asdf", "zzzz", "12ab34", "zxcvb"].forEach((t) => bad("business_type", t));
  ["Food & Beverage", "Healthcare"].forEach((t) => ok("industry", t));
  ["999", "--"].forEach((t) => bad("industry", t));

  ["Kopi Corner Pte Ltd", "7-Eleven", "3M"].forEach((t) => ok("business_name", t));
  ["123", "!!", "a"].forEach((t) => bad("business_name", t));
  ["Tan Ah Hock", "Mary-Jane O'Neil", "李明"].forEach((t) => ok("contact_name", t));
  ["12345", "J0hn"].forEach((t) => bad("contact_name", t));
  ["Owner", "Marketing Manager"].forEach((t) => ok("title_position", t));
  bad("title_position", "42");

  ["hello@kopicorner.sg", "a.b+c@x.co"].forEach((t) => ok("email", t));
  ["hello", "a@b", "a @b.com"].forEach((t) => bad("email", t));
  ["+65 6123 4567", "(02) 9876-5432", "91234567"].forEach((t) => ok("phone_number", t));
  ["123", "call me", "+65 1234 5678 9012 3456"].forEach((t) => bad("phone_number", t));
  ["kopicorner.sg", "https://www.kopicorner.sg/menu", "http://shop.example.com"].forEach((t) => ok("business_website", t));
  ["kopicorner", "not a site", "http://"].forEach((t) => bad("business_website", t));

  ok("design_preferences", "warm retro, brown and cream");
  ["!!", "12"].forEach((t) => bad("design_preferences", t));
  ok("requirements_notes", "Need posts by Friday");
  bad("requirements_notes", "123");

  // Optional fields: empty is fine; required empty fails with an example.
  ok("expected_annual_revenue", "");
  ok("business_type", "   ");
  const req = validateField("email", "", "Email", true);
  assert.ok(req && /required/.test(req.message) && req.example);
  n++;

  console.log(`validation: ${n} checks passed`);
} finally {
  await server.close();
}
