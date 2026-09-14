-- 0034 · יומן — אירועים ידניים (מודל האחסון של לוח השנה).
-- לוח השנה משלב שני מקורות: איסוף אוטומטי של תאריכים קיימים (ראיונות, משימות,
-- תחילת עבודה, סיום אחריות, מועדי תשלום) שנקרא ישירות מהטבלאות הקיימות בשכבת
-- האפליקציה, ואירועים ידניים שנשמרים כאן.
--
-- נראוּת (כבחירת המשתמש): כל מגייס רואה ועורך את האירועים שלו; המנהלת רואה
-- ועורכת את כולם. הטבלה נוצרה אחרי לולאת ה-RLS של 0008, כמו app.dev_ideas,
-- ולכן המדיניות מוגדרת כאן במפורש ואינה staff_all.

create table if not exists app.calendar_events (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references app.employees(id) on delete cascade,
  title          text not null check (length(btrim(title)) > 0),
  kind           text not null default 'general'
                 check (kind in ('general','meeting','call','reminder','deadline','personal')),
  starts_at      timestamptz not null,
  ends_at        timestamptz,
  all_day        boolean not null default false,
  location       text,
  notes          text,
  -- קישורים אופציונליים לישויות, לפתיחה מהיומן.
  candidate_id   uuid references app.candidates(id)   on delete set null,
  company_id     uuid references app.companies(id)    on delete set null,
  job_id         uuid references app.jobs(id)         on delete set null,
  application_id uuid references app.applications(id) on delete set null,
  created_by     uuid references app.employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ends_after_starts check (ends_at is null or ends_at >= starts_at)
);
create index if not exists calendar_events_owner_start on app.calendar_events (owner_id, starts_at);
create index if not exists calendar_events_start on app.calendar_events (starts_at);

create trigger touch before update on app.calendar_events
  for each row execute function app.touch_updated_at();

-- ---------- נראוּת: המגייס את שלו, המנהלת הכול ----------
alter table app.calendar_events enable row level security;

drop policy if exists cal_manager on app.calendar_events;
create policy cal_manager on app.calendar_events
  for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

drop policy if exists cal_own on app.calendar_events;
create policy cal_own on app.calendar_events
  for all to authenticated
  using (owner_id = app.current_employee())
  with check (owner_id = app.current_employee());

grant select, insert, update, delete on app.calendar_events to authenticated;
