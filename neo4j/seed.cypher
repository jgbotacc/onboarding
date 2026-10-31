// Field definitions: source of truth is Docs/b2b-registration-form.html (* = mandatory) + one MOCK demo client.
UNWIND [
  {key:'business_name', label:'Business Name', mandatory:true},
  {key:'business_type', label:'Business Type', mandatory:false},
  {key:'industry', label:'Industry', mandatory:false},
  {key:'business_website', label:'Business Website', mandatory:false},
  {key:'contact_name', label:'Contact Name', mandatory:true},
  {key:'title_position', label:'Title/Position', mandatory:false},
  {key:'email', label:'Email', mandatory:true},
  {key:'phone_number', label:'Phone Number', mandatory:false},
  {key:'design_preferences', label:'Design Preferences', mandatory:false},
  {key:'expected_annual_revenue', label:'Expected Annual Revenue', mandatory:false},
  {key:'requirements_notes', label:'Requirements / Notes', mandatory:false}
] AS f
MERGE (fd:FieldDef {key:f.key}) SET fd.label=f.label, fd.mandatory=f.mandatory;

// Remove field defs from the earlier placeholder list.
MATCH (fd:FieldDef) WHERE NOT fd.key IN ['business_name','business_type','industry','business_website','contact_name',
  'title_position','email','phone_number','design_preferences','expected_annual_revenue','requirements_notes']
DETACH DELETE fd;

// Drop orphaned fields left by the old list.
MATCH (fl:Field) WHERE NOT (fl)-[:OF_TYPE]->() DETACH DELETE fl;

// MOCK demo client: missing 'email' so the "please fill this in" path triggers.
MERGE (c:Client {id:'demo-client-1'})
  SET c.name='Kopi Corner (MOCK)', c.status='missing_info', c.createdAt=datetime()
MERGE (d:Document {id:'demo-doc-1'}) SET d.filename='kopi-corner-profile.pdf', d.parsedAt=datetime()
MERGE (c)-[:UPLOADED]->(d)
WITH c, d
UNWIND [
  {key:'business_name', value:'Kopi Corner Pte Ltd'},
  {key:'contact_name', value:'Ah Hock Tan'},
  {key:'industry', value:'F&B'},
  {key:'design_preferences', value:'Warm, retro kopitiam feel'}
] AS v
MATCH (fd:FieldDef {key:v.key})
MERGE (d)-[:HAS_FIELD]->(fl:Field {key:v.key, docId:d.id})
  SET fl.value=v.value, fl.valid=true
MERGE (fl)-[:OF_TYPE]->(fd);

MATCH (c:Client {id:'demo-client-1'})
MERGE (dd:DesignDirection {id:'demo-dir-1'})
  SET dd.summary='Warm, retro kopitiam feel', dd.requirements='Brown and cream palette', dd.source='form'
MERGE (c)-[:WANTS]->(dd);
