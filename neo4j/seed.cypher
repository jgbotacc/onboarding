// Field definitions (placeholder mandatory list until Jin confirms) + one MOCK demo client.
UNWIND [
  {key:'company_name', label:'Company name', mandatory:true},
  {key:'address', label:'Address', mandatory:true},
  {key:'contact', label:'Contact email or phone', mandatory:true},
  {key:'industry', label:'Industry', mandatory:true},
  {key:'uen', label:'UEN', mandatory:false},
  {key:'tagline', label:'Marketing tagline', mandatory:false},
  {key:'brand_colours', label:'Brand colours', mandatory:false},
  {key:'logo', label:'Logo', mandatory:false}
] AS f
MERGE (fd:FieldDef {key:f.key}) SET fd.label=f.label, fd.mandatory=f.mandatory;

// MOCK demo client: missing 'contact' so the "please fill this in" path triggers.
MERGE (c:Client {id:'demo-client-1'})
  SET c.name='Kopi Corner (MOCK)', c.status='missing_info', c.createdAt=datetime()
MERGE (d:Document {id:'demo-doc-1'}) SET d.filename='kopi-corner-profile.pdf', d.parsedAt=datetime()
MERGE (c)-[:UPLOADED]->(d)
WITH c, d
UNWIND [
  {key:'company_name', value:'Kopi Corner Pte Ltd'},
  {key:'address', value:'12 Example Road, Singapore 000000'},
  {key:'industry', value:'F&B'},
  {key:'tagline', value:'Your daily kopi, done right'}
] AS v
MATCH (fd:FieldDef {key:v.key})
MERGE (d)-[:HAS_FIELD]->(fl:Field {key:v.key, docId:d.id})
  SET fl.value=v.value, fl.valid=true
MERGE (fl)-[:OF_TYPE]->(fd);

MATCH (c:Client {id:'demo-client-1'})
MERGE (dd:DesignDirection {id:'demo-dir-1'})
  SET dd.summary='Warm, retro kopitiam feel', dd.requirements='Brown and cream palette', dd.source='form'
MERGE (c)-[:WANTS]->(dd);
