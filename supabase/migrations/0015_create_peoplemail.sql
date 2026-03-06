create extension if not exists "pgcrypto";

create table if not exists public.peoplemail (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  email text not null,
  campaign_date date not null,
  send_status text not null default 'sent' check (send_status in ('sent', 'duplicate', 'invalid')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (person_id, campaign_date)
);

create index if not exists idx_peoplemail_campaign_date
  on public.peoplemail(campaign_date);

create index if not exists idx_peoplemail_person_id
  on public.peoplemail(person_id);

create index if not exists idx_peoplemail_send_status
  on public.peoplemail(send_status);

create or replace function public.set_peoplemail_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_peoplemail_updated_at on public.peoplemail;

create trigger trg_peoplemail_updated_at
before update on public.peoplemail
for each row
execute function public.set_peoplemail_updated_at();

alter table public.peoplemail enable row level security;

drop policy if exists "Allow full access to authenticated users" on public.peoplemail;
create policy "Allow full access to authenticated users" on public.peoplemail
  for all using (auth.role() = 'authenticated');
