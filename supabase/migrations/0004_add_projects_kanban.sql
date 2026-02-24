create extension if not exists "uuid-ossp";

alter table purchases
  add column if not exists project_stage text check (project_stage in ('future', 'in_progress', 'done')) default 'future',
  add column if not exists project_started_at timestamptz;

update purchases
set project_stage = case
  when project_status = 'done' then 'done'
  when project_status = 'active' then 'in_progress'
  when project_status = 'on_hold' then 'future'
  else 'future'
end
where project_stage is null;

update purchases
set project_started_at = created_at
where project_stage = 'in_progress'
  and project_started_at is null;

create table if not exists project_activity_logs (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  purchase_id uuid not null references purchases(id) on delete cascade,
  from_stage text not null check (from_stage in ('future', 'in_progress', 'done')),
  to_stage text not null check (to_stage in ('future', 'in_progress', 'done')),
  moved_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now()
);

alter table project_activity_logs enable row level security;

create policy "Allow full access to authenticated users" on project_activity_logs
  for all using (auth.role() = 'authenticated');

create index if not exists idx_purchases_person_project_stage
  on purchases(person_id, project_stage);

create index if not exists idx_project_activity_logs_person_moved_at
  on project_activity_logs(person_id, moved_at desc);
