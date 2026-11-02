// Onboarding graph schema (Neo4j 5 / AuraDB Free). Idempotent: safe to re-run.
CREATE CONSTRAINT client_id IF NOT EXISTS FOR (c:Client) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE;
CREATE CONSTRAINT refimg_id IF NOT EXISTS FOR (r:ReferenceImage) REQUIRE r.id IS UNIQUE;
CREATE CONSTRAINT direction_id IF NOT EXISTS FOR (dd:DesignDirection) REQUIRE dd.id IS UNIQUE;
CREATE CONSTRAINT round_id IF NOT EXISTS FOR (g:GenerationRound) REQUIRE g.id IS UNIQUE;
CREATE CONSTRAINT handoff_id IF NOT EXISTS FOR (h:HumanHandoff) REQUIRE h.id IS UNIQUE;
CREATE CONSTRAINT fielddef_key IF NOT EXISTS FOR (fd:FieldDef) REQUIRE fd.key IS UNIQUE;
CREATE CONSTRAINT look_id IF NOT EXISTS FOR (l:Look) REQUIRE l.id IS UNIQUE;
CREATE CONSTRAINT consult_id IF NOT EXISTS FOR (k:Consult) REQUIRE k.id IS UNIQUE;
CREATE INDEX client_status IF NOT EXISTS FOR (c:Client) ON (c.status);
CREATE INDEX field_key IF NOT EXISTS FOR (f:Field) ON (f.key);

// Model
// (:Client {id, name, status: 'registering'|'missing_info'|'generating'|'awaiting_review'|'accepted'|'handed_off', createdAt})
// (:Client)-[:UPLOADED]->(:Document {id, filename, sandboxId, parsedAt})
// (:Document)-[:HAS_FIELD]->(:Field {key, value, confidence, valid:bool, issue})-[:OF_TYPE]->(:FieldDef {key, label, mandatory:bool})
// (:Client)-[:PROVIDED]->(:ReferenceImage {id, url, uploadedAt})
// (:Client)-[:WANTS]->(:DesignDirection {id, summary, requirements, source:'form'|'document'|'chat'})
// (:Client)-[:HAS_ROUND]->(:GenerationRound {id, n:1..3, imageUrls, feedback, accepted:bool, createdAt})
//   (:GenerationRound)-[:NEXT]->(:GenerationRound)
//   (:GenerationRound)-[:USED]->(:DesignDirection) / (:ReferenceImage)
// (:Client)-[:ESCALATED_TO]->(:HumanHandoff {id, reason, createdAt})   // after round 3 not accepted
// (:Client)-[:SHOWN]->(:Look {id, round, url, title, brief, selected, createdAt})
// (:Client)-[:NEEDS_CONSULT]->(:Consult {id, status, card, approvedBy, decidedAt, createdAt})
// (:Client)-[:AUDITED]->(:Audit {id, sessionId, actor, action, target, details, at})
// (:Client)-[:TRACED]->(:Trace {id, sessionId, step, model, ok, latencyMs, costSgd, error, at})
//   sessionless traces link (:System {id:'system'})-[:TRACED]->(:Trace) instead
// (:Eval {kind, score, n, details, at})
