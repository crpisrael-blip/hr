-- 0027 · מודול "forms" (בניית טפסים) + חשיפת ההרשאות ל-UI.
--
-- הבהרה: מנוע ההרשאות (app.effective_scope / app.owner_in_scope) והמדיניות
-- מודעת-ה-scope כבר קיימים מ-0022 — הם מיושמים על טבלאות הליבה
-- (candidates/jobs/applications/employees) וצורכים את המטריצה
-- (permission_defaults → profiles → overrides). כאן מוסיפים:
--   1. מודול forms — "בנייה" של מבנה הטפסים, נבדל מ"שליחה" (שנשלטת דרך
--      הכרטיס הרלוונטי, candidate_messages).
--   2. app.my_permissions — ה-view שמסך הצוות מושך כדי להסתיר/לחסום פעולות.
--   3. app.has_permission — קיצור בוליאני מעל effective_scope הקיים.
--   4. חיווט טבלאות בניית-הטפסים (form_templates/form_layouts/custom_fields)
--      למודול forms במקום הגייטים הקשיחים והלא-אחידים שהיו (staff/manager/superadmin).

-- ---------- מודול חדש ----------
-- ALTER TYPE ... ADD VALUE חייב לרוץ מחוץ לטרנזקציה; psql באוטוקומיט (הקובץ
-- ללא BEGIN) מבצע commit מיד, ולכן אפשר להשתמש ב-'forms' בהמשך הקובץ.
alter type app.perm_module add value if not exists 'forms';

-- ברירות מחדל: מגייס — אין בנייה; מנהלת/מנהל על — בנייה מלאה. (בפועל
-- effective_scope מחזיר 'all' למנהלת/מנהל-על על הכול; שורות אלה נועדו כדי
-- שמסך המטריצה יציג את התא, ושאפשר יהיה להעניק בנייה למגייס דרך פרופיל/override.)
insert into app.permission_defaults (role, module, action, scope)
select r, 'forms'::app.perm_module, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_action)) a
on conflict (role, module, action) do nothing;

update app.permission_defaults set scope = 'all'
 where module = 'forms'
   and role in ('manager','superadmin')
   and action in ('view','create','edit','delete');

-- ---------- קיצור בוליאני מעל המנוע הקיים ----------
create or replace function app.has_permission(p_module text, p_action text)
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select app.effective_scope(p_module, p_action) <> 'none'
$$;
grant execute on function app.has_permission(text, text) to authenticated;

-- ---------- ה-view לקריאת ההרשאות של המשתמש הנוכחי ----------
-- מסך הצוות מושך את זה פעם אחת ומסתיר/חוסם פעולות לא-מורשות. מחזיר רק
-- שילובים עם היקף אפקטיבי כלשהו (> none). security_invoker כדי שהחישוב
-- יתייחס למשתמש הקורא (הפונקציות שבתוכו הן SECURITY DEFINER בכל מקרה).
create or replace view app.my_permissions
with (security_invoker = true) as
  select m::text as module, a::text as action, app.effective_scope(m::text, a::text) as scope
  from unnest(enum_range(null::app.perm_module)) m
  cross join unnest(enum_range(null::app.perm_action)) a
  where app.effective_scope(m::text, a::text) <> 'none';
grant select on app.my_permissions to authenticated;

-- ---------- חיווט טבלאות בניית-הטפסים למודול forms ----------
-- קריאה נשארת לכל הצוות; כתיבה (בנייה) נשלטת ע"י המטריצה במקום גייט קשיח.
-- אלו טבלאות תצורה ללא בעלות פר-שורה → די בבדיקת היקף <> none.
-- form_instances/form_events (שליחת טופס) נשארים כפי שהם — שליחה דרך הכרטיס.

-- form_templates: היה staff מלא (גם מגייס יכול היה) → עכשיו בנייה לפי forms.
drop policy if exists form_templates_staff on app.form_templates;
drop policy if exists form_templates_read on app.form_templates;
create policy form_templates_read on app.form_templates for select to authenticated
  using ((select app.is_staff()));
drop policy if exists form_templates_insert on app.form_templates;
create policy form_templates_insert on app.form_templates for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
drop policy if exists form_templates_update on app.form_templates;
create policy form_templates_update on app.form_templates for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
drop policy if exists form_templates_delete on app.form_templates;
create policy form_templates_delete on app.form_templates for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');

-- custom_fields: היה write=manager → עכשיו לפי forms.
drop policy if exists custom_fields_write on app.custom_fields;
create policy custom_fields_insert on app.custom_fields for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
create policy custom_fields_update on app.custom_fields for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
create policy custom_fields_delete on app.custom_fields for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');

-- form_layouts: היה write=superadmin → עכשיו לפי forms (מנהלת מקבלת גם היא).
drop policy if exists form_layouts_write on app.form_layouts;
create policy form_layouts_insert on app.form_layouts for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
create policy form_layouts_update on app.form_layouts for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
create policy form_layouts_delete on app.form_layouts for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');
