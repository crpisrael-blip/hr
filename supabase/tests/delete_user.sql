-- בדיקות הרשאת מחיקת משתמש (0036): app.may_delete_user / app.can_delete_users.
-- מזכיר: מחיקת משתמש נשלטת אך ורק ע"י המטריצה users_permissions/delete —
-- אין short-circuit לפי תפקיד. מנהל על = 'all' כברירת מחדל → מותר; מנהלת
-- ומגייס = 'none' → אסור אלא אם הוענק במפורש; deny גובר.
\set ON_ERROR_STOP on

alter table auth.users add column if not exists email text;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  u_rec uuid := gen_random_uuid();
  u_mgr uuid := gen_random_uuid();
  u_sa  uuid := gen_random_uuid();
  e_rec uuid; e_mgr uuid; e_sa uuid;
begin
  insert into auth.users (id, email) values
    (u_rec, 'rec@del.test'), (u_mgr, 'mgr@del.test'), (u_sa, 'sa@del.test');
  insert into app.employees (user_id, full_name, email, role) values
    (u_rec, 'מגייס',   'rec@del.test', 'recruiter')  returning id into e_rec;
  insert into app.employees (user_id, full_name, email, role) values
    (u_mgr, 'מנהלת',   'mgr@del.test', 'manager')    returning id into e_mgr;
  insert into app.employees (user_id, full_name, email, role) values
    (u_sa,  'מנהל על', 'sa@del.test',  'superadmin') returning id into e_sa;

  ----------------------------------------------------- ברירות המחדל
  if not app.may_delete_user(u_sa)  then raise exception 'מנהל על אמור להיות מורשה למחוק'; end if;
  if     app.may_delete_user(u_mgr) then raise exception 'מנהלת אינה אמורה למחוק כברירת מחדל'; end if;
  if     app.may_delete_user(u_rec) then raise exception 'מגייס אינו אמור למחוק'; end if;
  if     app.may_delete_user(null)  then raise exception 'null אינו מורשה'; end if;
  if     app.may_delete_user(gen_random_uuid()) then raise exception 'משתמש לא-קיים אינו מורשה'; end if;

  ------------------------------------------- הרחבה דרך המטריצה (override/grant)
  insert into app.permission_overrides (employee_id, module, action, scope, kind, granted_by, reason)
    values (e_mgr, 'users_permissions', 'delete', 'all', 'grant', e_sa, 'בדיקה');
  if not app.may_delete_user(u_mgr) then raise exception 'מנהלת עם grant אמורה להיות מורשה'; end if;

  ------------------------------------------------------- deny גובר על grant
  insert into app.permission_overrides (employee_id, module, action, scope, kind, granted_by, reason)
    values (e_mgr, 'users_permissions', 'delete', 'all', 'deny', e_sa, 'בדיקה');
  if app.may_delete_user(u_mgr) then raise exception 'deny אמור לגבור על grant'; end if;

  -------------------------------------------- override שפג תוקפו — מתעלמים ממנו
  update app.permission_overrides set valid_until = now() - interval '1 day'
   where employee_id = e_mgr and module = 'users_permissions' and action = 'delete';
  if app.may_delete_user(u_mgr) then raise exception 'grant/deny שפגו → חוזרים לברירת המחדל (none)'; end if;

  ------------------------------------------------ can_delete_users לפי המשתמש הנוכחי
  perform set_config('test.uid', u_sa::text, true);
  if not app.can_delete_users() then raise exception 'can_delete_users: מנהל על אמור true'; end if;
  perform set_config('test.uid', u_mgr::text, true);
  if app.can_delete_users() then raise exception 'can_delete_users: מנהלת אמורה false'; end if;

  raise notice 'כל בדיקות מחיקת המשתמש עברו';
end $$;
