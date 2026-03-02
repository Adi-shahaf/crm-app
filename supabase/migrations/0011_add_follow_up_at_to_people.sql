alter table people
  add column if not exists follow_up_at timestamptz;
