-- Remove the global is_pinned column
alter table people drop column if exists is_pinned;

-- Create a table for per-user pinned items
create table if not exists user_pinned_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz default now(),
  unique(user_id, person_id)
);

-- Enable RLS
alter table user_pinned_items enable row level security;

-- Policies: Users can only see and manage their own pins
create policy "Users can view their own pins"
  on user_pinned_items for select
  using (auth.uid() = user_id);

create policy "Users can insert their own pins"
  on user_pinned_items for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own pins"
  on user_pinned_items for delete
  using (auth.uid() = user_id);
