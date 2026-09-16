-- שדה "תחום" למשרה: קטגוריה לחיפוש וסינון (באתר הציבורי ובמערכת הצוות).
-- קטלוג סגור (enum) כדי לאפשר דרופדאון ושבבי-תחומים עקביים כמו באתרי דרושים.
create type app.job_field as enum (
  'software','engineering','finance','sales_marketing','customer_service',
  'industry','construction','logistics','healthcare','education',
  'hr_admin','management','other');

alter table app.jobs add column field app.job_field;

-- חשיפה באתר הציבורי: הוספת התחום ל-view המשרות המפורסמות.
-- field מתווסף בסוף הרשימה כדי ש-create or replace view יתקבל (אסור לשנות
-- סדר/שם של עמודות קיימות ב-replace; מותר להוסיף בסוף).
create or replace view app.published_jobs as
select p.slug,
       p.public_title            as title,
       p.public_body             as body,
       coalesce(p.public_location, j.location) as location,
       j.employment_scope,
       case when p.expose_company_name then c.name end as company_name,
       p.published_at,
       j.field
from app.job_publications p
join app.jobs      j on j.id = p.job_id
join app.companies c on c.id = j.company_id
where p.status = 'published'
  and j.stage in ('open','on_hold');
