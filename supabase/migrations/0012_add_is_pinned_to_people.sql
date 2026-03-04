alter table people
  add column if not exists is_pinned boolean default false;
