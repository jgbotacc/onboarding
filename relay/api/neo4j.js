// POST {statement, parameters} -> Aura HTTPS Query API (auth added here).
const { rawBody, forward, guard } = require("../lib/relay");

module.exports = guard(async (req, res) => {
  const host = (process.env.NEO4J_URI || "").split("://").pop().split(/[:/]/)[0];
  const db = process.env.NEO4J_DATABASE || "neo4j";
  const auth = Buffer.from(`${process.env.NEO4J_USERNAME}:${process.env.NEO4J_PASSWORD}`).toString("base64");
  await forward(res, `https://${host}/db/${db}/query/v2`, {
    method: "POST", body: await rawBody(req),
    headers: { "content-type": "application/json", accept: "application/json", authorization: `Basic ${auth}` },
  });
});
