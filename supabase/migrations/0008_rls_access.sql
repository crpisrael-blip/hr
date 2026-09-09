-- 0008 · גישת אפליקציית הצוות: חשיפת סכמת app ל-PostgREST ומדיניות RLS.
-- אכיפת MVP: רק עובד צוות פעיל ומחובר ניגש. חלוקת ההיקפים המדויקת (שלי/צוות/הכל)
-- תיאכף בשכבת ה-API בהמשך; כאן RLS מבטיח שרק צוות מזוהה נכנס בכלל.

-- ---------- מיהו המשתמש הנוכחי ----------
create or replace function app.current_employee()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select e.id from app.employees e
  where e.user_id = auth.uid() and e.employment_status = 'active'
  limit 1
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select exists (
    select 1 from app.employees e
    where e.user_id = auth.uid() and e.employment_status = 'active'
  )
$$;

create or replace function app.is_manager()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select exists (
    select 1 from app.employees e
    where e.user_id = auth.uid() and e.employment_status = 'active'
      and e.role in ('manager','superadmin')
  )
$$;

-- ---------- הרשאות ל-PostgREST ----------
grant usage on schema app to authenticated;
grant select, insert, update, delete on all tables in schema app to authenticated;
grant usage, select on all sequences in schema app to authenticated;
alter default privileges in schema app grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app grant usage, select on sequences to authenticated;

-- ---------- הפעלת RLS ומדיניות "צוות בלבד" על כל טבלאות app ----------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'app'
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists staff_all on app.%I', t);
    execute format(
      'create policy staff_all on app.%I for all to authenticated using (app.is_staff()) with check (app.is_staff())', t);
  end loop;
end $$;

-- אירועי ביקורת: צוות רשאי להוסיף ולקרוא, אך לא לעדכן/למחוק (נאכף גם ב-0001).
drop policy if exists staff_all on audit.events;

-- ---------- קישור העובד הראשון (מנהלת) ----------
-- הרצה ידנית אחרי יצירת משתמש ב-Authentication:
--   select app.link_employee('EMAIL', 'שם מלא', 'manager');
create or replace function app.link_employee(p_email text, p_name text, p_role app.user_role default 'manager')
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_id uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'לא נמצא משתמש עם הדוא"ל %. צור אותו קודם ב-Authentication.', p_email;
  end if;
  insert into app.employees (user_id, full_name, email, role)
  values (v_uid, p_name, lower(p_email), p_role)
  on conflict (email) do update
    set user_id = excluded.user_id, full_name = excluded.full_name, role = excluded.role,
        employment_status = 'active'
  returning id into v_id;
  return v_id;
end $$;
