-- 0022 · הקשחת אבטחה: הרשאות, RLS מודע-היקף, יומן ביקורת והסתרת שדות כספיים.
-- מטפל בממצאי הביקורת C1, C2, C3, H9, H10, H11, M3, M8, M9, M13, L5.
--
-- הרעיון המרכזי: עד כה מדיניות אחת גורפת (staff_all, 0008:41-52) נתנה לכל עובד
-- פעיל CRUD מלא על כל טבלאות app — כולל התפקיד של עצמו, ההגדרות וההרשאות.
-- כאן מפרקים אותה לארבע מדיניות נפרדות (קריאה/הוספה/עדכון/מחיקה), מוסיפים
-- טבלאות שרק מנהלת כותבת אליהן, ומכניסים היקפי הרשאה (שלי/צוות/הכל) לתוך RLS.
-- הקובץ idempotent: אפשר להריץ אותו שוב על אותו מסד.

-- ============================================================================
-- 1. עזרי היקף (C3) — מטריצת ההרשאות הופכת מנתונים מתים לכלל אכיפה
-- ============================================================================

-- הצוות של המשתמש המחובר (לצורך היקף "הצוות שלי").
create or replace function app.my_team()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select e.team_id from app.employees e
  where e.user_id = auth.uid() and e.employment_status = 'active'
  limit 1
$$;

-- ההיקף האפקטיבי של המשתמש המחובר למודול/פעולה:
--   ברירת מחדל לתפקיד  ->  כללי פרופילים  ->  עקיפות פר משתמש.
-- שלילה פר משתמש גוברת על הכול (אפיון, סעיף מטריצת ההרשאות, כלל 1).
-- עקיפה שפג תוקפה אינה נספרת (כלל 5).
-- אם אין אף שורה מתאימה מחזירים 'all' — כלומר ההתנהגות שהייתה עד היום,
-- כדי שהוספת מודול חדש לא תנעל בשוגג את המערכת.
create or replace function app.effective_scope(p_module text, p_action text)
returns text
language plpgsql stable security definer set search_path = app, auth, public as $$
declare
  v_mod   app.perm_module;
  v_act   app.perm_action;
  v_emp   app.employees%rowtype;
  v_scope app.perm_scope;
begin
  begin
    v_mod := p_module::app.perm_module;
    v_act := p_action::app.perm_action;
  exception when others then
    return 'all';   -- מודול/פעולה שאינם במטריצה: לא חוסמים
  end;

  select * into v_emp from app.employees
   where user_id = auth.uid() and employment_status = 'active'
   limit 1;
  if v_emp.id is null then return 'none'; end if;

  -- מנהלת ומנהל על נשארים 'all' (אפיון, טבלת ברירות המחדל).
  if v_emp.role in ('manager','superadmin') then return 'all'; end if;

  if exists (
    select 1 from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = v_mod and o.action = v_act
       and o.kind = 'deny'
       and (o.valid_until is null or o.valid_until > now())
  ) then
    return 'none';
  end if;

  select max(s) into v_scope from (
    select d.scope as s
      from app.permission_defaults d
     where d.role = v_emp.role and d.module = v_mod and d.action = v_act
    union all
    select r.scope
      from app.permission_profile_rules r
      join app.employee_permission_profiles ep on ep.profile_id = r.profile_id
     where ep.employee_id = v_emp.id and r.module = v_mod and r.action = v_act
    union all
    select o.scope
      from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = v_mod and o.action = v_act
       and o.kind = 'grant'
       and (o.valid_until is null or o.valid_until > now())
  ) x;

  if v_scope is null then return 'all'; end if;
  return v_scope::text;
end $$;

-- האם שורה שבבעלות p_owner נמצאת בהיקף p_scope עבור המשתמש p_me.
-- שורה ללא אחראי (owner is null) נחשבת מאגר משותף — כך שמועמד שנוצר
-- מהאתר הציבורי אינו הופך לבלתי ניתן לעריכה לאיש מלבד המנהלת.
create or replace function app.owner_in_scope(
  p_scope text, p_me uuid, p_my_team uuid, p_owner uuid)
returns boolean
language sql stable security definer set search_path = app, public as $$
  select case
    when p_scope is null   then true
    when p_scope = 'all'   then true
    when p_scope = 'none'  then false
    when p_owner is null   then true
    when p_scope = 'own'   then p_owner = p_me
    when p_scope = 'team'  then p_owner = p_me
                              or (p_my_team is not null and exists (
                                    select 1 from app.employees o
                                     where o.id = p_owner and o.team_id = p_my_team))
    else true
  end
$$;

-- ============================================================================
-- 2. נעילת כרטיס העובד (C2) — אי אפשר לקדם את עצמך
-- ============================================================================
-- הטריגר חל על כל עדכון, גם כזה שעוקף RLS דרך PostgREST. הקשר ללא JWT
-- (postgres מה-SQL Editor, service_role מפונקציות הקצה) מזוהה לפי
-- auth.uid() is null ומורשה — שם ההגנה היא ההרשאה להתחבר בכלל.
create or replace function app.guard_employee_privileges()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if auth.uid() is null then
    return new;   -- הקשר שרת (service_role / SQL Editor)
  end if;

  if (new.role is distinct from old.role
      or new.employment_status is distinct from old.employment_status
      or new.user_id is distinct from old.user_id)
     and not app.is_manager() then
    raise exception 'שינוי תפקיד, סטטוס העסקה או חשבון משתמש שמור למנהלת בלבד';
  end if;

  if new.role = 'superadmin' and old.role is distinct from 'superadmin'
     and not app.is_superadmin() then
    raise exception 'רק מנהל על יכול להעניק תפקיד מנהל על';
  end if;

  return new;
end $$;

drop trigger if exists guard_employee_privileges on app.employees;
create trigger guard_employee_privileges before update on app.employees
  for each row execute function app.guard_employee_privileges();

-- M9: אותו חשבון auth אינו יכול להיות גם עובד וגם מועמד (אפיון, מודל המידע).
create or replace function app.guard_user_identity()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if new.user_id is null then return new; end if;
  if tg_table_name = 'employees' then
    if exists (select 1 from app.candidates c where c.user_id = new.user_id) then
      raise exception 'חשבון זה כבר משויך למועמד ואינו יכול לשמש כעובד';
    end if;
  else
    if exists (select 1 from app.employees e where e.user_id = new.user_id) then
      raise exception 'חשבון זה כבר משויך לעובד ואינו יכול לשמש כמועמד';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_user_identity on app.employees;
create trigger guard_user_identity before insert or update of user_id on app.employees
  for each row execute function app.guard_user_identity();
drop trigger if exists guard_user_identity on app.candidates;
create trigger guard_user_identity before insert or update of user_id on app.candidates
  for each row execute function app.guard_user_identity();

-- ============================================================================
-- 3. יומן ביקורת (H9) — מהיום באמת נכתב אליו
-- ============================================================================
grant usage on schema audit to authenticated;
grant select, insert on audit.events to authenticated;
grant usage, select on sequence audit.events_id_seq to authenticated;
grant usage on schema audit to service_role;
grant all on audit.events to service_role;
grant usage, select on sequence audit.events_id_seq to service_role;
revoke update, delete, truncate on audit.events from public, authenticated;

alter table audit.events enable row level security;
drop policy if exists audit_insert_staff on audit.events;
create policy audit_insert_staff on audit.events for insert to authenticated
  with check ((select app.is_staff()) and actor_id = auth.uid());
drop policy if exists audit_read_manager on audit.events;
create policy audit_read_manager on audit.events for select to authenticated
  using ((select app.is_manager()));

-- טריגר גנרי: מי עשה, על מה, מה היה ומה נהיה.
create or replace function audit.log_change()
returns trigger
language plpgsql security definer set search_path = app, audit, auth, public as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_old   jsonb;
  v_new   jsonb;
  v_key   text;
begin
  if v_actor is not null then
    select e.full_name into v_label from app.employees e where e.user_id = v_actor limit 1;
    -- actor_id מצביע ל-auth.users; אם המשתמש אינו שם (בדיקות) לא מפילים פעולה עסקית.
    if not exists (select 1 from auth.users u where u.id = v_actor) then
      v_actor := null;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  end if;

  v_key := coalesce(v_new->>'id', v_old->>'id', v_new->>'key', v_old->>'key',
                    v_new->>'stage', v_old->>'stage',
                    v_new->>'employee_id', v_old->>'employee_id');

  insert into audit.events (actor_id, actor_label, action, entity_type, entity_id, changes)
  values (v_actor, v_label, lower(tg_op), tg_table_schema || '.' || tg_table_name, v_key,
          jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new)));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'employees','settings','permission_defaults','permission_profiles',
    'permission_profile_rules','employee_permission_profiles','permission_overrides',
    'agreements','stage_exposure']
  loop
    execute format('drop trigger if exists audit_log on app.%I', t);
    execute format(
      'create trigger audit_log after insert or update or delete on app.%I
         for each row execute function audit.log_change()', t);
  end loop;
end $$;

-- ============================================================================
-- 4. פירוק staff_all לארבע מדיניות (C2)
-- ============================================================================
-- קריאה: כל עובד פעיל. כתיבה: עובד פעיל, ובטבלאות ההגדרות/ההרשאות/המסחר —
-- מנהלת בלבד. מחיקה: מנהלת, למעט טבלאות תפעוליות שהאפליקציה מוחקת מהן בפועל.
-- כל קריאה ל-is_staff()/is_manager() עטופה ב-(select ...) כדי שתוערך פעם אחת
-- לשאילתה ולא לכל שורה (M13).
do $$
declare
  t          text;
  wr         text;
  del        text;
  mgr_write  text[] := array[
    'settings','teams','permission_defaults','permission_profiles',
    'permission_profile_rules','employee_permission_profiles','permission_overrides',
    'agreements','stage_exposure','automation_rules','job_publications'];
  -- טבלאות עם מדיניות ייעודית משלהן (כאן או במיגרציות קודמות)
  skip_tables text[] := array[
    'dev_ideas','employee_documents','employee_feedback','custom_fields',
    'job_stage_history','form_templates','form_instances','form_events',
    'public_submission_log','employees','candidates','jobs','applications',
    'application_stage_history'];
  -- שורות תפעוליות שהצוות מוחק בעבודה השוטפת
  staff_delete text[] := array[
    'documents','document_analyses','candidate_consents','client_submissions',
    'interviews','conversations','conversation_messages','activities',
    'task_assignees','task_links','task_reminders','saved_jobs','job_alerts',
    'outbound_messages','task_process_items'];
begin
  for t in select tablename from pg_tables where schemaname = 'app' order by tablename loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists staff_all on app.%I', t);
    continue when t = any(skip_tables);

    wr  := case when t = any(mgr_write) then '(select app.is_manager())' else '(select app.is_staff())' end;
    del := case when t = any(mgr_write) then '(select app.is_manager())'
                when t = any(staff_delete) then '(select app.is_staff())'
                else '(select app.is_manager())' end;

    execute format('drop policy if exists staff_read on app.%I', t);
    execute format('create policy staff_read on app.%I for select to authenticated using ((select app.is_staff()))', t);
    execute format('drop policy if exists staff_write on app.%I', t);
    execute format('create policy staff_write on app.%I for insert to authenticated with check (%s)', t, wr);
    execute format('drop policy if exists staff_update on app.%I', t);
    execute format('create policy staff_update on app.%I for update to authenticated using (%s) with check (%s)', t, wr, wr);
    execute format('drop policy if exists row_delete on app.%I', t);
    execute format('create policy row_delete on app.%I for delete to authenticated using (%s)', t, del);
  end loop;
end $$;

-- ---------- עובדים ----------
-- קריאה לכל הצוות (הממשק מציג שמות אחראים); הוספה ומחיקה למנהלת;
-- עדכון למנהלת או לשורה של עצמי — והטריגר שלמעלה חוסם העלאת הרשאות.
alter table app.employees enable row level security;
drop policy if exists employees_read on app.employees;
create policy employees_read on app.employees for select to authenticated
  using ((select app.is_staff()));
drop policy if exists employees_insert on app.employees;
create policy employees_insert on app.employees for insert to authenticated
  with check ((select app.is_manager()));
drop policy if exists employees_update on app.employees;
create policy employees_update on app.employees for update to authenticated
  using ((select app.is_manager()) or user_id = auth.uid())
  with check ((select app.is_manager()) or user_id = auth.uid());
drop policy if exists employees_delete on app.employees;
create policy employees_delete on app.employees for delete to authenticated
  using ((select app.is_manager()));

-- ---------- מועמדים, משרות ומועמדויות: RLS מודע-היקף (C3) ----------
alter table app.candidates enable row level security;
drop policy if exists candidates_read on app.candidates;
create policy candidates_read on app.candidates for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','view')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id));
drop policy if exists candidates_insert on app.candidates;
create policy candidates_insert on app.candidates for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('candidates','create')) <> 'none');
drop policy if exists candidates_update on app.candidates;
create policy candidates_update on app.candidates for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','edit')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','edit')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id));
drop policy if exists candidates_delete on app.candidates;
create policy candidates_delete on app.candidates for delete to authenticated
  using ((select app.is_manager()));

alter table app.jobs enable row level security;
drop policy if exists jobs_read on app.jobs;
create policy jobs_read on app.jobs for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','view')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists jobs_insert on app.jobs;
create policy jobs_insert on app.jobs for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('jobs','create')) <> 'none');
drop policy if exists jobs_update on app.jobs;
create policy jobs_update on app.jobs for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists jobs_delete on app.jobs;
create policy jobs_delete on app.jobs for delete to authenticated
  using ((select app.is_manager()));

alter table app.applications enable row level security;
drop policy if exists applications_read on app.applications;
create policy applications_read on app.applications for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','view')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists applications_insert on app.applications;
create policy applications_insert on app.applications for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('applications','create')) <> 'none');
drop policy if exists applications_update on app.applications;
create policy applications_update on app.applications for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists applications_delete on app.applications;
create policy applications_delete on app.applications for delete to authenticated
  using ((select app.is_manager()));

-- ---------- היסטוריית שלבים: קריאה בלבד ללקוח (H9) ----------
-- הכתיבה עוברת מהיום דרך app.set_application_stage (0023), בדיוק כמו
-- job_stage_history שנכתב מטריגר בלבד (0019).
alter table app.application_stage_history enable row level security;
drop policy if exists ash_read on app.application_stage_history;
create policy ash_read on app.application_stage_history for select to authenticated
  using ((select app.is_staff()));
revoke insert, update, delete on app.application_stage_history from authenticated;
revoke update, delete on app.job_stage_history from authenticated;

-- ---------- טפסים (M2) ----------
-- מופע טופס מכיל ת"ז, פרטי בנק והצהרות בריאות. מהיום נחשף ליוצר ולמנהלת בלבד.
alter table app.form_instances enable row level security;
drop policy if exists form_instances_staff on app.form_instances;
drop policy if exists form_instances_owner on app.form_instances;
create policy form_instances_owner on app.form_instances for all to authenticated
  using ((select app.is_manager()) or created_by = (select app.current_employee()))
  with check ((select app.is_manager()) or created_by = (select app.current_employee()));

alter table app.form_events enable row level security;
drop policy if exists form_events_staff on app.form_events;
drop policy if exists form_events_owner on app.form_events;
create policy form_events_owner on app.form_events for all to authenticated
  using ((select app.is_manager()) or exists (
           select 1 from app.form_instances i
            where i.id = instance_id and i.created_by = (select app.current_employee())))
  with check ((select app.is_manager()) or exists (
           select 1 from app.form_instances i
            where i.id = instance_id and i.created_by = (select app.current_employee())));

-- תבניות: קריאה לכל הצוות (צריך כדי לשלוח טופס), עריכה למנהלת.
alter table app.form_templates enable row level security;
drop policy if exists form_templates_staff on app.form_templates;
drop policy if exists form_templates_read on app.form_templates;
drop policy if exists form_templates_write on app.form_templates;
create policy form_templates_read on app.form_templates for select to authenticated
  using ((select app.is_staff()));
create policy form_templates_write on app.form_templates for all to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

-- ============================================================================
-- 5. קישור עובד — נעילת מסלול ההסלמה (C1)
-- ============================================================================
-- הפונקציה נועדה להרצה ידנית אחת מה-SQL Editor. היא נשארת, אבל:
--   (א) ה-EXECUTE נשלל מ-public/anon/authenticated — אי אפשר לקרוא לה מ-REST.
--   (ב) גם אם תוענק שוב בטעות, היא מסרבת אלא אם: אין אף עובד במערכת (bootstrap),
--       או שהקורא מנהל על, או שזו הרצה ישירה מהמסד ללא JWT.
-- current_user חסר ערך כאן: בפונקציית SECURITY DEFINER הוא תמיד בעל הפונקציה.
-- לכן נבדקים session_user (רול ההתחברות האמיתי) ו-auth.uid().
create or replace function app.link_employee(p_email text, p_name text, p_role app.user_role default 'manager')
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_id uuid; v_any boolean;
begin
  select exists (select 1 from app.employees) into v_any;
  if v_any
     and not app.is_superadmin()
     and not (auth.uid() is null and session_user in ('postgres','supabase_admin')) then
    raise exception 'app.link_employee שמורה למנהל על או להרצה ישירה מהמסד';
  end if;

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

-- ניתוק חשבון משתמש מרשומת מועמד (H12) — מסלול התיקון כשקישור שגוי קרה.
create or replace function app.unlink_candidate_user(p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת מנתקת חשבון מועמד'; end if;
  update app.candidates set user_id = null where id = p_candidate_id;
end $$;

-- ============================================================================
-- 6. הרשאות הרצה והרשאות ברירת מחדל (H11, M3)
-- ============================================================================
-- 0017 ביטלה את ה-EXECUTE הגורף מ-PUBLIC אך לא קבעה ברירת מחדל, ולכן כל
-- פונקציה שנוצרה אחריה חזרה להיות ניתנת להרצה ע"י anon. כאן נסגר גם העתיד.
alter default privileges in schema app     revoke execute on functions from public;
alter default privileges in schema finance revoke execute on functions from public;
alter default privileges in schema audit   revoke execute on functions from public;

-- ברירת המחדל הגורפת על טבלאות עתידיות (0008:37, 0009:8) פתחה כל טבלה חדשה
-- לכל משתמש מחובר עוד לפני שנקבעה לה RLS. מבטלים; מעניקים במפורש פר טבלה.
alter default privileges in schema app     revoke select, insert, update, delete on tables from authenticated;
alter default privileges in schema finance revoke select, insert, update, delete on tables from authenticated;

revoke execute on all functions in schema app     from public, anon;
revoke execute on all functions in schema finance from public, anon;
grant  execute on all functions in schema app     to authenticated, service_role;
grant  execute on all functions in schema finance to authenticated, service_role;

-- ארבע פונקציות ה-token הציבוריות בלבד ל-anon.
grant execute on function app.form_open(text)          to anon;
grant execute on function app.form_save(text, jsonb)   to anon;
grant execute on function app.form_submit(text, jsonb) to anon;
grant execute on function app.site_apply_form()        to anon;

-- C1: אין דרך לקרוא ל-link_employee מהרשת.
revoke execute on function app.link_employee(text, text, app.user_role) from public, anon, authenticated;
grant  execute on function app.unlink_candidate_user(uuid) to authenticated;

-- ============================================================================
-- 7. הסתרת שדות כספיים ממגייס (H10)
-- ============================================================================
-- הרשאות עמודתיות אינן יכולות להבחין בין מגייס למנהלת (שניהם authenticated),
-- לכן הטבלה יורדת מתחת לקרקע ובמקומה תצוגה: המנהלת רואה הכול, המגייס רואה
-- את ההשמות שלו בלבד וללא שכר/אחוז/עמלה. שמות העמודות והסדר נשמרו, כך
-- ששאילתות team-app הקיימות (כולל select *) ממשיכות לעבוד.
do $$
begin
  if to_regclass('finance.placements_private') is null then
    alter table finance.placements rename to placements_private;
  end if;
end $$;

create or replace view finance.placements with (security_barrier = true) as
select p.id,
       p.application_id,
       p.company_id,
       p.recruiter_id,
       p.agreement_id,
       p.accepted_at,
       p.expected_start_date,
       p.verified_start_date,
       case when (select app.is_manager()) then p.agreed_salary end       as agreed_salary,
       p.commission_base,
       case when (select app.is_manager()) then p.commission_pct end      as commission_pct,
       case when (select app.is_manager()) then p.expected_commission end as expected_commission,
       p.currency,
       p.warranty_days,
       p.warranty_ends_on,
       p.status,
       p.approved_by,
       p.approved_at,
       p.ended_reason,
       p.created_by,
       p.created_at,
       p.updated_at
from finance.placements_private p
where (select app.is_manager())
   or p.recruiter_id = (select app.current_employee());

-- הטבלה עצמה נסגרת ללקוחות; כל כתיבה עוברת דרך פונקציות SECURITY DEFINER.
revoke all on finance.placements_private from authenticated, anon;
grant select on finance.placements to authenticated;
grant all    on finance.placements to service_role;
grant all    on finance.placements_private to service_role;

-- ============================================================================
-- 8. שלמות נתונים (M9) ואינדקסים (M13)
-- ============================================================================
create unique index if not exists employees_email_lower_uniq on app.employees (lower(email));

alter table finance.placements_private drop constraint if exists placements_commission_pct_chk;
alter table finance.placements_private add  constraint placements_commission_pct_chk
  check (commission_pct > 0 and commission_pct <= 1000);
alter table finance.placements_private drop constraint if exists placements_warranty_days_chk;
alter table finance.placements_private add  constraint placements_warranty_days_chk
  check (warranty_days >= 0);

-- interviews.status היה טקסט חופשי; מצמצמים לערכים החוקיים בלבד.
alter table app.interviews drop constraint if exists interviews_status_chk;
alter table app.interviews add  constraint interviews_status_chk
  check (status in ('scheduled','done','cancelled','no_show'));

-- settings/stage_exposure: חותמת זמן ומי עדכן, אוטומטית.
create or replace function app.touch_settings()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists touch_settings on app.settings;
create trigger touch_settings before update on app.settings
  for each row execute function app.touch_settings();

create or replace function app.touch_stage_exposure()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.current_employee(), new.updated_by);
  return new;
end $$;
drop trigger if exists touch_stage_exposure on app.stage_exposure;
create trigger touch_stage_exposure before update on app.stage_exposure
  for each row execute function app.touch_stage_exposure();

-- עמודות מפתח זר ללא אינדקס — הכבדות שבהן (M13).
create index if not exists bonus_lines_placement       on finance.bonus_calculation_lines (placement_id);
create index if not exists bonus_lines_clawback        on finance.bonus_calculation_lines (clawback_id);
create index if not exists placements_company          on finance.placements_private (company_id);
create index if not exists placements_agreement        on finance.placements_private (agreement_id);
create index if not exists placements_created_by       on finance.placements_private (created_by);
create index if not exists clawback_employee           on finance.clawback_proposals (employee_id);
create index if not exists clawback_calculation        on finance.clawback_proposals (calculation_id);
create index if not exists receipt_alloc_invoice       on finance.receipt_allocations (invoice_id);
create index if not exists bonus_calc_employee         on finance.bonus_calculations (employee_id);
create index if not exists conversations_recruiter     on app.conversations (recruiter_id);
create index if not exists tasks_parent                on app.tasks (parent_task_id);
create index if not exists tasks_recurrence            on app.tasks (recurrence_id);
create index if not exists tasks_automation_rule       on app.tasks (automation_rule_id);
create index if not exists deletion_requests_candidate on app.deletion_requests (candidate_id);
create index if not exists document_analyses_document  on app.document_analyses (document_id);
create index if not exists saved_jobs_publication      on app.saved_jobs (publication_id);
create index if not exists employees_manager           on app.employees (manager_id);
create index if not exists teams_lead                  on app.teams (lead_employee_id);
create index if not exists documents_uploaded_by       on app.documents (uploaded_by);
create index if not exists agreements_created_by       on app.agreements (created_by);
create index if not exists client_submissions_document on app.client_submissions (document_id);
create index if not exists client_submissions_contact  on app.client_submissions (contact_id);
create index if not exists conv_messages_document      on app.conversation_messages (document_id);

-- ============================================================================
-- 9. נרמול טלפון (L5)
-- ============================================================================
-- "0" הפך עד היום ל-"+972" ונשמר כמפתח כפילות. מהיום מוחזר null לכל מה
-- שאינו מספר ישראלי תקין (קווי 8 ספרות / נייד 9 ספרות אחרי הקידומת),
-- ומספר בינלאומי מפורש (+ ואחריו 8–15 ספרות) עובר כמות שהוא.
create or replace function app.normalize_phone(raw text)
returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') as v),
  n as (
    select case
      when (select v from d) = ''         then null
      when (select v from d) like '+972%' then '+972' || regexp_replace(substr((select v from d), 5), '^0', '')
      when (select v from d) like '972%'  then '+972' || regexp_replace(substr((select v from d), 4), '^0', '')
      when (select v from d) like '0%'    then '+972' || substr((select v from d), 2)
      else (select v from d)
    end as v
  )
  select case
    when (select v from n) is null                       then null
    when (select v from n) ~ '^\+972[2-9][0-9]{7,8}$'    then (select v from n)
    when (select v from n) ~ '^\+(?!972)[1-9][0-9]{7,14}$' then (select v from n)
    else null
  end
$$;

-- ============================================================================
-- 10. אחסון (M8)
-- ============================================================================
do $$
begin
  if to_regclass('storage.objects') is not null then
    -- מסמכי מועמדים: צוות קורא רק מועמדים שבהיקף שלו, ולא את כל המאגר.
    drop policy if exists staff_reads_docs on storage.objects;
    create policy staff_reads_docs on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs' and (select app.is_staff())
             and exists (select 1 from app.candidates c
                          where c.id::text = (storage.foldername(name))[1]
                            and app.owner_in_scope(
                                  (select app.effective_scope('candidates','view')),
                                  (select app.current_employee()), (select app.my_team()),
                                  c.owner_employee_id)));

    -- מגייס יכול להעלות קו"ח למועמד שבהיקף שלו (עד היום לא היה מסלול כזה).
    drop policy if exists staff_writes_docs on storage.objects;
    create policy staff_writes_docs on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs' and (select app.is_staff())
             and exists (select 1 from app.candidates c
                          where c.id::text = (storage.foldername(name))[1]
                            and app.owner_in_scope(
                                  (select app.effective_scope('candidates','edit')),
                                  (select app.current_employee()), (select app.my_team()),
                                  c.owner_employee_id)));

    -- מחיקת קובץ של מועמד: המועמד עצמו (החלפת גרסה) או מנהלת.
    drop policy if exists candidate_deletes_own on storage.objects;
    create policy candidate_deletes_own on storage.objects for delete to authenticated
      using (bucket_id = 'candidate-docs'
             and ((storage.foldername(name))[1] = (select app.current_candidate())::text
                  or (select app.is_manager())));

    -- form-uploads: עד היום לא הייתה לאיש מדיניות insert, ולכן כל העלאה נכשלה.
    drop policy if exists form_uploads_staff_write on storage.objects;
    create policy form_uploads_staff_write on storage.objects for insert to authenticated
      with check (bucket_id = 'form-uploads' and ((select app.is_staff()) or (select app.current_candidate()) is not null));
    drop policy if exists form_uploads_mgr_delete on storage.objects;
    create policy form_uploads_mgr_delete on storage.objects for delete to authenticated
      using (bucket_id = 'form-uploads' and (select app.is_manager()));
  end if;
end $$;

-- ============================================================================
-- 11. מה נאכף מהיום במסד — ומה עדיין לא (C3)
-- ============================================================================
-- נאכף במסד:
--   · רק עובד פעיל ומזוהה ניגש לסכמות app/finance, ורק דרך RLS.
--   · תפקיד, סטטוס העסקה וחשבון המשתמש של עובד ניתנים לשינוי בידי מנהלת בלבד,
--     ותפקיד מנהל על בידי מנהל על בלבד (טריגר, חל גם על PostgREST).
--   · הגדרות, מטריצת ההרשאות, הסכמים, חשיפת שלבים, אוטומציות, צוותים ופרסומים:
--     קריאה לצוות, כתיבה למנהלת.
--   · מחיקה פיזית: מנהלת בלבד, למעט שורות תפעוליות; מחיקת מועמד מבוקרת דרך
--     app.anonymize_candidate (0023).
--   · היקף שלי/צוות/הכל על מועמדים, משרות ומועמדויות — נקרא ממטריצת ההרשאות
--     בזמן אמת דרך app.effective_scope, כולל שלילה פר משתמש ותוקף.
--   · שדות כספיים בהשמה מוסתרים ממי שאינו מנהלת (תצוגה במקום טבלה).
--   · כל שינוי בכרטיס עובד, בהגדרות, בהרשאות, בהסכמים ובחשיפת השלבים נרשם
--     ב-audit.events, שהוא append-only גם למי שמחובר ישירות למסד.
-- עדיין לא נאכף במסד (דורש שכבת API, SPEC:133):
--   · היקפים במודולים חיובים/התחשבנות/דוחות/ייבוא/אתר — שם ההפרדה היא עדיין
--     מנהלת מול מגייס בלבד.
--   · הסתרת שדות רגישים ברזולוציית שדה מעבר לשדות ההשמה.
--   · כלל "אי אפשר להעניק יותר ממה שיש למעניק" (אפיון, כלל 3) — נבדק בממשק בלבד.
--   · אימות דו-שלבי (SPEC:129) — הדגל קיים, האכיפה אינה במסד.
