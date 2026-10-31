// POST Resend email payload -> api.resend.com/emails. Only the demo recipient is allowed.
const { rawBody, forward, guard } = require("../lib/relay");
const ALLOWED = ["willhanjg01@gmail.com"];

module.exports = guard(async (req, res) => {
  let msg;
  try { msg = JSON.parse((await rawBody(req)).toString("utf8")); } catch { msg = null; }
  const to = msg && (Array.isArray(msg.to) ? msg.to : [msg.to]);
  const bad = !to || !to.length || to.some((t) => !ALLOWED.includes(String(t).toLowerCase()))
    || msg.cc || msg.bcc;
  if (bad) { res.statusCode = 403; res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ error: "recipient not allowed" })); }
  await forward(res, "https://api.resend.com/emails", {
    method: "POST", body: JSON.stringify(msg),
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
});
