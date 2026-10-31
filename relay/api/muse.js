// POST /api/muse?op=generations|edits -> api.meta.ai/v1/images/<op>. Body passed through as-is (JSON or multipart).
const { rawBody, forward, guard } = require("../lib/relay");
const OPS = new Set(["generations", "edits"]);

module.exports = guard(async (req, res) => {
  const op = new URL(req.url, "http://x").searchParams.get("op") || "generations";
  if (!OPS.has(op)) { res.statusCode = 400; return res.end(JSON.stringify({ error: "op must be generations or edits" })); }
  await forward(res, `https://api.meta.ai/v1/images/${op}`, {
    method: "POST", body: await rawBody(req),
    headers: { "content-type": req.headers["content-type"] || "application/json",
               authorization: `Bearer ${process.env.MODEL_API_KEY}` },
  });
});
