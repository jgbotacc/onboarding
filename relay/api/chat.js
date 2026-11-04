// POST OpenAI-style chat/completions JSON -> api.meta.ai first, Baseten backup.
// Body passed through as-is; Meta uses the body's model unless RELAY_META_CHAT_MODEL
// is set. Baseten uses model "meta-models/muse-spark-open-1026" unless
// BASETEN_MODEL is set. Replies carry x-relay-provider: meta|baseten|none.
const { rawBody, guard } = require("../lib/relay");

const META_URL = "https://api.meta.ai/v1/chat/completions";
const BASETEN_URL = "https://inference.baseten.co/v1/chat/completions";
const BASETEN_DEFAULT_MODEL = "meta-models/muse-spark-open-1026";

async function postJson(url, key, obj, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const up = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(obj),
      signal: ctrl.signal,
    });
    return { status: up.status,
             contentType: up.headers.get("content-type") || "application/json",
             buf: Buffer.from(await up.arrayBuffer()) };
  } finally {
    clearTimeout(t);
  }
}

function send(res, status, contentType, buf, provider) {
  res.statusCode = status;
  res.setHeader("content-type", contentType);
  res.setHeader("x-relay-provider", provider);
  res.end(buf);
}

module.exports = guard(async (req, res) => {
  let body;
  try {
    body = JSON.parse((await rawBody(req)).toString("utf8"));
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.setHeader("x-relay-provider", "none");
    return res.end(JSON.stringify({ error: "JSON body required" }));
  }

  const metaBody = { ...body };
  if (process.env.RELAY_META_CHAT_MODEL) metaBody.model = process.env.RELAY_META_CHAT_MODEL;

  let metaRes = null;
  try {
    metaRes = await postJson(META_URL, process.env.MODEL_API_KEY, metaBody, 25000);
  } catch {
    metaRes = null;
  }
  if (metaRes && metaRes.status >= 200 && metaRes.status < 300) {
    return send(res, metaRes.status, metaRes.contentType, metaRes.buf, "meta");
  }

  if (process.env.BASETEN_API_KEY) {
    const basetenBody = { ...body, model: process.env.BASETEN_MODEL || BASETEN_DEFAULT_MODEL };
    let basetenRes = null;
    try {
      basetenRes = await postJson(BASETEN_URL, process.env.BASETEN_API_KEY, basetenBody, 20000);
    } catch {
      basetenRes = null;
    }
    if (basetenRes && basetenRes.status >= 200 && basetenRes.status < 300) {
      return send(res, basetenRes.status, basetenRes.contentType, basetenRes.buf, "baseten");
    }
    if (basetenRes) {
      return send(res, basetenRes.status, basetenRes.contentType, basetenRes.buf, "none");
    }
  }

  if (metaRes) {
    return send(res, metaRes.status, metaRes.contentType, metaRes.buf, "none");
  }
  res.statusCode = 502;
  res.setHeader("content-type", "application/json");
  res.setHeader("x-relay-provider", "none");
  res.end(JSON.stringify({ error: "relay upstream failed" }));
});
