# Neo4j onboarding graph
Load order (Aura console Query tab or cypher-shell): `schema.cypher`, then `seed.cypher`.
`queries.cypher` holds the 3 app queries (missing fields, new round, feedback/handoff) with $params.
Field list mirrors Docs/b2b-registration-form.html; mandatory: business_name, contact_name, email. Demo client is missing email on purpose.
Demo client is labelled MOCK and is missing `contact`, so query 1 returns it.
No credentials here; connection details live in ../.env.
