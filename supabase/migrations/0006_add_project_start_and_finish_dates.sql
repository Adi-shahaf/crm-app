alter table purchases
  add column if not exists project_start_date date,
  add column if not exists project_finish_date date;

update purchases
set project_start_date = coalesce(project_start_date, project_started_at::date)
where project_started_at is not null;
