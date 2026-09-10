-- לוג שינויי סטטוס למשרה + תחזוקה אוטומטית של תאריכי פתיחה/סגירה.
-- מזין את "לוג השינויים" בכרטיס המשרה, ותופס כל שינוי סטטוס — גם מרשימת
-- המשרות (פרסום) וגם מהכרטיס.

create table if not exists app.job_stage_history (
  id          bigserial primary key,
  job_id      uuid not null references app.jobs(id) on delete cascade,
  from_stage  app.job_stage,
  to_stage    app.job_stage not null,
  reason      text,
  changed_by  uuid references app.employees(id),
  changed_at  timestamptz not null default now()
);
create index if not exists job_stage_history_job on app.job_stage_history (job_id, changed_at desc);

-- BEFORE: תחזוקת opened_at/closed_at לפי הסטטוס.
create or replace function app.jobs_stage_dates()
returns trigger language plpgsql set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    if new.stage = 'open' and new.opened_at is null then new.opened_at := current_date; end if;
    if new.stage in ('closed','filled') and new.closed_at is null then new.closed_at := current_date; end if;
    -- פתיחה מחדש מנקה את תאריך הסגירה.
    if new.stage in ('open','on_hold','draft') then new.closed_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_stage_dates on app.jobs;
create trigger jobs_stage_dates before update on app.jobs
  for each row execute function app.jobs_stage_dates();

-- AFTER: רישום שינוי הסטטוס בלוג (SECURITY DEFINER כדי לכתוב ללוג בלי תלות ב-RLS).
create or replace function app.jobs_log_stage()
returns trigger language plpgsql security definer set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    insert into app.job_stage_history (job_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, app.current_employee());
  end if;
  return null;
end $$;
drop trigger if exists jobs_log_stage on app.jobs;
create trigger jobs_log_stage after update on app.jobs
  for each row execute function app.jobs_log_stage();

-- RLS: הצוות קורא את הלוג.
alter table app.job_stage_history enable row level security;
drop policy if exists job_stage_history_read on app.job_stage_history;
create policy job_stage_history_read on app.job_stage_history for select to authenticated
  using (app.is_staff());
grant select on app.job_stage_history to authenticated;
