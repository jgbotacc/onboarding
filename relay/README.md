# Relay (Vercel)
Pass-through so the Daytona sandbox (Tier 1 allowlist includes *.vercel.app) can reach Aura, Muse Image, Resend and chat.
All endpoints are POST and need header `x-relay-secret: $RELAY_SECRET`.
- `/api/neo4j` body `{statement, parameters}` -> Aura Query API
- `/api/muse?op=generations|edits` -> api.meta.ai/v1/images/<op>
- `/api/resend` -> api.resend.com/emails (recipient must be listed in `ALLOWED_RECIPIENT`, comma-separated; unset = all refused)
- `/api/chat` body OpenAI-style chat/completions JSON -> api.meta.ai first, Baseten backup; replies carry `x-relay-provider: meta|baseten|none`

Vercel env: RELAY_SECRET, NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD, NEO4J_DATABASE, MODEL_API_KEY, RESEND_API_KEY, ALLOWED_RECIPIENT, BASETEN_API_KEY. Optional: BASETEN_MODEL (default meta-models/muse-spark-open-1026), RELAY_META_CHAT_MODEL (overrides the chat body model on Meta).
Local test: `node scripts/serve.js` (plain node server mounting the same handlers).
