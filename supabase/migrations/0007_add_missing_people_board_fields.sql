alter table people
  add column if not exists whatsapp_response text,
  add column if not exists employment_status text,
  add column if not exists lead_idea text,
  add column if not exists seller text,
  add column if not exists campaign text,
  add column if not exists ad_name text,
  add column if not exists total_contracts numeric,
  add column if not exists status text,
  add column if not exists lead_status text;
