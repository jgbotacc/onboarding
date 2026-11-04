// Local test server for the relay functions (no Vercel needed): node scripts/serve.js [port]
const http = require("http");
const routes = { "/api/neo4j": require("../api/neo4j"), "/api/muse": require("../api/muse"),
                 "/api/resend": require("../api/resend"), "/api/health": require("../api/health"),
                 "/api/chat": require("../api/chat") };
const port = Number(process.argv[2] || 8790);
http.createServer((req, res) => {
  const h = routes[new URL(req.url, "http://x").pathname];
  if (!h) { res.statusCode = 404; return res.end("not found"); }
  h(req, res);
}).listen(port, "127.0.0.1", () => console.log(`relay on http://127.0.0.1:${port}`));
