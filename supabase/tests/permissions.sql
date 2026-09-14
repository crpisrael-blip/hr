-- בדיקות מנוע ההרשאות ומודול forms (0027) מול המנוע הקיים (0022).
-- מזכיר: effective_scope מחזיר 'all' למנהלת/מנהל-על על כל מודול/פעולה
-- (short-circuit לפי התפקיד); למגייס — לפי המטריצה; deny גובר; מודול לא-מוכר → 'all'.
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
  p_fin uuid;
begin
  insert into auth.users (id, email) values
    (u_rec, 'rec@perm.test'), (u_mgr, 'mgr@perm.test'), (u_sa, 'sa@perm.test');
  insert into app.employees (user_id, full_name, email, role) values
    (u_rec, 'מגייס', 'rec@perm.test', 'recruiter') returning id into e_rec;
  insert into app.employees (user_id, full_name, email, role) values
    (u_mgr, 'מנהלת', 'mgr@perm.test', 'manager') returning id into e_mgr;
  insert into app.employees (user_id, full_name, email, role) values
    (u_sa, 'מנהל על', 'sa@perm.test', 'superadmin') returning id into e_sa;

  ---------------------------------------------------- מגייס: לפי המטריצה
  perform set_config('test.uid', u_rec::text, true);
  if app.effective_scope('candidates','view')   <> 'all'  then raise exception 'מגייס: candidates/view=all'; end if;
  if app.effective_scope('candidates','edit')   <> 'own'  then raise exception 'מגייס: candidates/edit=own'; end if;
  if app.effective_scope('candidates','delete') <> 'none' then raise exception 'מגייס: candidates/delete=none'; end if;
  if app.effective_scope('invoicing','view')    <> 'none' then raise exception 'מגייס: invoicing/view=none'; end if;
  if app.effective_scope('forms','view')        <> 'none' then raise exception 'מגייס: forms/view=none'; end if;
  if app.effective_scope('forms','create')      <> 'none' then raise exception 'מגייס: forms/create=none'; end if;
  if app.has_permission('forms','create')                 then raise exception 'מגייס: has_permission forms/create=false'; end if;

  ------------------------------------ מנהלת/מנהל על: all על הכול (short-circuit)
  perform set_config('test.uid', u_mgr::text, true);
  if app.effective_scope('forms','create')       <> 'all' then raise exception 'מנהלת: forms/create=all'; end if;
  if app.effective_scope('candidates','delete')  <> 'all' then raise exception 'מנהלת: candidates/delete=all'; end if;
  if app.effective_scope('system_settings','edit') <> 'all' then raise exception 'מנהלת: system_settings/edit=all'; end if;
  if not app.has_permission('forms','delete')            then raise exception 'מנהלת: has_permission forms/delete=true'; end if;

  perform set_config('test.uid', u_sa::text, true);
  if app.effective_scope('forms','create')          <> 'all' then raise exception 'מנהל על: forms/create=all'; end if;
  if app.effective_scope('users_permissions','edit') <> 'all' then raise exception 'מנהל על: users_permissions/edit=all'; end if;

  --------------------------------------- מודול לא-מוכר → all (לא לנעול בשוגג)
  perform set_config('test.uid', u_rec::text, true);
  if app.effective_scope('no_such_module','view') <> 'all' then raise exception 'מודול לא-מוכר צריך all'; end if;

  ------------------------------------------------------------ שכבה 2: פרופיל
  select id into p_fin from app.permission_profiles where name = 'כספים';
  insert into app.employee_permission_profiles (employee_id, profile_id) values (e_rec, p_fin);
  if app.effective_scope('invoicing','view')   <> 'all'  then raise exception 'מגייס+כספים: invoicing/view=all'; end if;
  if app.effective_scope('invoicing','edit')   <> 'all'  then raise exception 'מגייס+כספים: invoicing/edit=all'; end if;
  if app.effective_scope('invoicing','delete') <> 'none' then raise exception 'פרופיל כספים לא מעניק delete'; end if;

  ------------------------------------------------ שכבה 3: override מסוג grant
  insert into app.permission_overrides (employee_id, module, action, scope, kind, granted_by, reason)
    values (e_rec, 'forms', 'create', 'all', 'grant', e_mgr, 'בדיקה');
  if app.effective_scope('forms','create') <> 'all' then raise exception 'grant: forms/create=all למגייס'; end if;

  ------------------------------------------------- שכבה 3: override מסוג deny
  insert into app.permission_overrides (employee_id, module, action, scope, kind, granted_by, reason)
    values (e_rec, 'candidates', 'view', 'all', 'deny', e_mgr, 'בדיקה');
  if app.effective_scope('candidates','view') <> 'none' then raise exception 'deny: candidates/view=none'; end if;

  update app.permission_overrides set valid_until = now() - interval '1 day'
   where employee_id = e_rec and module = 'candidates' and action = 'view' and kind = 'deny';
  if app.effective_scope('candidates','view') <> 'all' then raise exception 'deny שפג → חוזר ל-all'; end if;

  ---------------------------------------------------- משתמש לא-מזוהה → none
  perform set_config('test.uid', gen_random_uuid()::text, true);
  if app.effective_scope('candidates','view') <> 'none' then raise exception 'לא-עובד → none'; end if;

  ------------------------------------------------------ app.my_permissions
  perform set_config('test.uid', u_rec::text, true);
  if not exists (select 1 from app.my_permissions where module='candidates' and action='view' and scope='all') then
    raise exception 'my_permissions: חסרה candidates/view=all למגייס';
  end if;
  if exists (select 1 from app.my_permissions where scope='none') then
    raise exception 'my_permissions: אסור שורות none';
  end if;

  raise notice 'כל בדיקות מנוע ההרשאות ומודול forms עברו';
end $$;
