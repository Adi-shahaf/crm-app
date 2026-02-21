-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Table: groups
create table if not exists groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  sort_order int not null default 0,
  type text not null check (type in ('lead_stage', 'customer_segment', 'archive')),
  created_at timestamptz default now()
);

-- Table: people
create table if not exists people (
  id uuid primary key default uuid_generate_v4(),
  full_name text not null,
  phone text,
  email text,
  source text,
  group_id uuid references groups(id) on delete set null,
  score_1_3 int check (score_1_3 >= 1 and score_1_3 <= 3),
  external_source_id text unique,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Table: purchases
create table if not exists purchases (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references people(id) on delete cascade,
  service_id text,
  price numeric,
  payment_method text,
  payment_status text check (payment_status in ('pending', 'paid', 'refunded')),
  project_status text check (project_status in ('active', 'done', 'on_hold')),
  created_at timestamptz default now()
);

-- Table: notes
create table if not exists notes (
  id uuid primary key default uuid_generate_v4(),
  person_id uuid not null references people(id) on delete cascade,
  type text check (type in ('call', 'email', 'meeting', 'note')),
  content text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- Row Level Security (RLS)
-- For MVP, we will allow all authenticated users (Operators) to do everything.
-- This assumes all users in auth.users are internal staff.

alter table groups enable row level security;
alter table people enable row level security;
alter table purchases enable row level security;
alter table notes enable row level security;

-- Policies for groups
create policy "Allow full access to authenticated users" on groups
  for all using (auth.role() = 'authenticated');

-- Policies for people
create policy "Allow full access to authenticated users" on people
  for all using (auth.role() = 'authenticated');

-- Policies for purchases
create policy "Allow full access to authenticated users" on purchases
  for all using (auth.role() = 'authenticated');

-- Policies for notes
create policy "Allow full access to authenticated users" on notes
  for all using (auth.role() = 'authenticated');

-- Trigger to auto-update updated_at for people
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_people_updated_at
  before update on people
  for each row
  execute function update_updated_at_column();

-- Insert default groups
insert into groups (name, sort_order, type) values 
('New Leads', 10, 'lead_stage'),
('Contacted', 20, 'lead_stage'),
('Meeting Scheduled', 30, 'lead_stage'),
('Customers', 40, 'customer_segment'),
('Lost / Archive', 50, 'archive')
on conflict do nothing;
