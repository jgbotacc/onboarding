// Shared helpers: secret check, raw body read, upstream pass-through.
const crypto = require("crypto");

function authorised(req) {
  const want = process.env.RELAY_SECRET || "";
  const got = String(req.headers["x-relay-secret"] || "");
  if (!want || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function rawBody(req) {
  // Stream the raw body; never touch req.body (Vercel parses it lazily and would consume the stream).
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function forward(res, url, init) {
  const up = await fetch(url, init);
  const buf = Buffer.from(await up.arrayBuffer());
  res.statusCode = up.status;
  res.setHeader("content-type", up.headers.get("content-type") || "application/octet-stream");
  res.end(buf);
}

function guard(handler) {
  return async (req, res) => {
    if (req.method !== "POST") { res.statusCode = 405; return res.end(JSON.stringify({ error: "POST only" })); }
    if (!authorised(req)) { res.statusCode = 401; return res.end(JSON.stringify({ error: "unauthorised" })); }
    try { await handler(req, res); } catch (e) {
      res.statusCode = 502; res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: "relay upstream failed", detail: String(e && e.message || e).slice(0, 300) }));
    }
  };
}

module.exports = { authorised, rawBody, forward, guard };
