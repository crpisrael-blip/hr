-- 0035 · משתתפים ואישור השתתפות באירועי יומן.
-- כל עובד יכול לזמן כל עובד אחר בחברה לאירוע שהוא יוצר. מוזמן רואה את האירוע
-- ביומן שלו (אישור צפייה) ויכול לאשר/לדחות השתתפות (אישור השתתפות).

create table if not exists app.calendar_event_participants (
  event_id     uuid not null references app.calendar_events(id) on delete cascade,
  employee_id  uuid not null references app.employees(id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending','accepted','declined')),
  invited_by   uuid references app.employees(id),
  responded_at timestamptz,
  created_at   timestamptz not null default now(),
  primary key (event_id, employee_id)
);
create index if not exists cal_participants_emp on app.calendar_event_participants (employee_id, status);

-- ---------- עוזרים ב-SECURITY DEFINER ----------
-- עוקפים RLS כדי למנוע רקורסיה בין המדיניות של calendar_events לזו של המשתתפים.
create or replace function app.is_calendar_participant(p_event uuid)
returns boolean language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.calendar_event_participants p
    where p.event_id = p_event and p.employee_id = app.current_employee()
  )
$$;

create or replace function app.owns_calendar_event(p_event uuid)
returns boolean language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.calendar_events e
    where e.id = p_event and e.owner_id = app.current_employee()
  )
$$;

grant execute on function app.is_calendar_participant(uuid), app.owns_calendar_event(uuid) to authenticated;

-- ---------- אירוע שהוזמנתי אליו מופיע ביומן שלי ----------
drop policy if exists cal_participant on app.calendar_events;
create policy cal_participant on app.calendar_events for select to authenticated
  using (app.is_calendar_participant(id));

-- ---------- נראוּת וניהול שורות המשתתפים ----------
alter table app.calendar_event_participants enable row level security;

-- צפייה: מנהלת, בעל האירוע, או המשתתף עצמו.
drop policy if exists cep_read on app.calendar_event_participants;
create policy cep_read on app.calendar_event_participants for select to authenticated
  using (app.is_manager() or employee_id = app.current_employee() or app.owns_calendar_event(event_id));

-- ניהול הרשימה (הזמנה/הסרה): מנהלת או בעל האירוע.
drop policy if exists cep_manage on app.calendar_event_participants;
create policy cep_manage on app.calendar_event_participants for all to authenticated
  using (app.is_manager() or app.owns_calendar_event(event_id))
  with check (app.is_manager() or app.owns_calendar_event(event_id));

-- אישור/דחיית השתתפות: המשתתף מעדכן את השורה שלו בלבד.
drop policy if exists cep_rsvp on app.calendar_event_participants;
create policy cep_rsvp on app.calendar_event_participants for update to authenticated
  using (employee_id = app.current_employee())
  with check (employee_id = app.current_employee());

grant select, insert, update, delete on app.calendar_event_participants to authenticated;
