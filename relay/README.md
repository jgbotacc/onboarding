# Relay (Vercel)
Pass-through so the Daytona sandbox (Tier 1 allowlist includes *.vercel.app) can reach Aura, Muse Image and Resend.
All endpoints are POST and need header `x-relay-secret: $RELAY_SECRET`.
- `/api/neo4j` body `{statement, parameters}` -> Aura Query API
- `/api/muse?op=generations|edits` -> api.meta.ai/v1/images/<op>
- `/api/resend` -> api.resend.com/emails (recipient must be willhanjg01@gmail.com)

Vercel env: RELAY_SECRET, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, MODEL_API_KEY, RESEND_API_KEY.
Local test: `node scripts/serve.js` (plain node server mounting the same handlers).
