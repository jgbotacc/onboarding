# Neo4j onboarding graph
Load order (Aura console Query tab or cypher-shell): `schema.cypher`, then `seed.cypher`.
`queries.cypher` holds the 3 app queries (missing fields, new round, feedback/handoff) with $params.
Mandatory field list in seed is a placeholder (company_name, address, contact, industry) until Jin confirms.
Demo client is labelled MOCK and is missing `contact`, so query 1 returns it.
No credentials here; connection details live in ../.env.
