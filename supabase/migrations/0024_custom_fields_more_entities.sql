-- הרחבת מנוע השדות המותאמים לשלושה סוגי ישות נוספים: עובד/מגייס, משימה והשמה.
-- מנהל-על מוסיף ועורך את השדות מתוך הטופס עצמו (כפתור "עריכת שדות"), בלי קוד.
-- הערכים יושבים באובייקט custom של כל ישות, כמו בסוגים הקיימים (0018).

-- 1) הרחבת רשימת הסוגים המותרים ב-custom_fields.
alter table app.custom_fields drop constraint if exists custom_fields_entity_type_check;
alter table app.custom_fields add  constraint custom_fields_entity_type_check
  check (entity_type in ('candidate','job','company','application','employee','task','placement'));

-- 2) עמודת הערכים על הישויות הנכתבות ישירות (RLS קיים מתיר את הכתיבה).
alter table app.tasks     add column if not exists custom jsonb not null default '{}'::jsonb;
alter table app.employees add column if not exists custom jsonb not null default '{}'::jsonb;

-- 3) השמה: הטבלה פרטית (service_role בלבד) ומוצגת דרך view. מוסיפים עמודה,
-- חושפים אותה ב-view, וכותבים אליה דרך פונקציית SECURITY DEFINER בלבד.
alter table finance.placements_private add column if not exists custom jsonb not null default '{}'::jsonb;

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
       p.updated_at,
       p.custom
from finance.placements_private p
where (select app.is_manager())
   or p.recruiter_id = (select app.current_employee());

grant select on finance.placements to authenticated;

-- שמירת שדות מותאמים להשמה. גישה זהה לראות ההשמה ב-view: מנהלת, או המגייס
-- שההשמה שלו. שדות כספיים אינם נגעים כאן — רק custom.
create or replace function finance.set_placement_custom(p_id uuid, p_custom jsonb)
returns void
language plpgsql security definer set search_path = finance, app, public as $$
begin
  if p_custom is null or jsonb_typeof(p_custom) <> 'object' then
    raise exception 'custom חייב להיות אובייקט JSON';
  end if;
  update finance.placements_private p
     set custom = p_custom, updated_at = now()
   where p.id = p_id
     and ((select app.is_manager()) or p.recruiter_id = (select app.current_employee()));
  if not found then
    raise exception 'ההשמה לא נמצאה או שאין הרשאה' using errcode = 'P0002';
  end if;
end $$;

revoke all     on function finance.set_placement_custom(uuid, jsonb) from public, anon;
grant  execute on function finance.set_placement_custom(uuid, jsonb) to authenticated;
