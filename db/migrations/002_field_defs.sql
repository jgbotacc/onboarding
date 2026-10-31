-- Field list from Docs/b2b-registration-form.html (mandatory = 1)
CREATE TABLE IF NOT EXISTS field_defs (key TEXT PRIMARY KEY, label TEXT NOT NULL, mandatory INTEGER NOT NULL);
DELETE FROM field_defs;
INSERT INTO field_defs(key, label, mandatory) VALUES
 ('business_name','Business Name',1), ('business_type','Business Type',0), ('industry','Industry',0),
 ('business_website','Business Website',0), ('contact_name','Contact Name',1), ('title_position','Title/Position',0),
 ('email','Email',1), ('phone_number','Phone Number',0), ('design_preferences','Design Preferences',0),
 ('expected_annual_revenue','Expected Annual Revenue',0), ('requirements_notes','Requirements / Notes',0);
