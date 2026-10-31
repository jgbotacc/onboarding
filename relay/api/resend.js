// POST Resend email payload -> api.resend.com/emails. Only recipients in ALLOWED_RECIPIENT are allowed.
const { rawBody, forward, guard } = require("../lib/relay");

// Comma-separated allow-list from the Vercel env. Unset or empty = every recipient is refused (fails closed).
function allowed() {
  return String(process.env.ALLOWED_RECIPIENT || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

module.exports = guard(async (req, res) => {
  let msg;
  try { msg = JSON.parse((await rawBody(req)).toString("utf8")); } catch { msg = null; }
  const to = msg && (Array.isArray(msg.to) ? msg.to : [msg.to]);
  const ALLOWED = allowed();
  const bad = !ALLOWED.length || !to || !to.length || to.some((t) => !ALLOWED.includes(String(t).toLowerCase()))
    || msg.cc || msg.bcc;
  if (bad) { res.statusCode = 403; res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "recipient not allowed" })); }
  await forward(res, "https://api.resend.com/emails", {
    method: "POST", body: JSON.stringify(msg),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
});
