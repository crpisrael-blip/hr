-- ============================================================================
-- דאטה ניסיונית לבדיקות עומס — נפרד לחלוטין מקוד התוכנה.
-- ----------------------------------------------------------------------------
-- מייצר נתונים סינתטיים בהיקף הייצור של הלקוחה: חברות עם הסכם זהה, משרות עם
-- דרישות (חובה/יתרון/תחום), מועמדים, קורות-חיים (רשומת מסמך + ניתוח AI מדומה),
-- ומועמדויות. הכול set-based (generate_series) — מהיר גם ב-80k.
--
-- ⚠ להרצה מול מסד **בדיקות/סטייג׳ינג בלבד**, לעולם לא מול הייצור. הריצו דרך
--   scripts/seed/run-seed.sh, שמסרב ליעד שנראה כמו ייצור.
--
-- דורש שהסכימה כבר קיימת (supabase/schema.sql או המיגרציות + מיגרציית 0037,
-- שמוסיפה את app.job_field).
--
-- פרמטרים (psql -v שם=ערך). ברירות מחדל = "שלב קטן":
--   n_companies   (ברירת מחדל 180)
--   n_teams       (ברירת מחדל 6)
--   n_employees   (ברירת מחדל 20)   -- מגייסים
--   n_jobs        (ברירת מחדל 700)
--   n_candidates  (ברירת מחדל 5000) -- לנפח מלא: 80000
-- ============================================================================

\if :{?n_companies}  \else \set n_companies  180  \endif
\if :{?n_teams}      \else \set n_teams      6    \endif
\if :{?n_employees}  \else \set n_employees  20   \endif
\if :{?n_jobs}       \else \set n_jobs       700  \endif
\if :{?n_candidates} \else \set n_candidates 5000 \endif

\set ON_ERROR_STOP on
set client_min_messages to warning;

begin;
select setseed(0.42);   -- בר-שחזור: אותה דאטה בכל הרצה

-- ---------- קטלוג ערכים עבריים (שורה אחת, מוצלב לכל insert) ----------
create temporary table _cat on commit drop as select
  array['דניאל','נועה','יוסי','מאיה','אורי','שירה','איתי','תמר','עומר','ליאור',
        'רון','יעל','גיא','הדס','אסף','רותם','ניר','מיכל','אלון','דנה',
        'עידו','נטע','שי','אורית','בר','גל']::text[]                                   as fn,
  array['כהן','לוי','מזרחי','פרץ','ביטון','אברהם','פרידמן','דוד','שפירא','אזולאי',
        'חדד','גבאי','מלכה','אוחיון','ברק','רוזן','סגל','נחום','בן דוד','גולן']::text[] as ln,
  array['תל אביב','ירושלים','חיפה','באר שבע','ראשון לציון','פתח תקווה','נתניה',
        'אשדוד','הרצליה','רעננה','כפר סבא','מודיעין','רמת גן','חולון','אשקלון',
        'נצרת','עפולה','טבריה','אילת','עבודה היברידית','עבודה מרחוק']::text[]           as cities,
  array['Excel','SQL','Python','ניהול צוות','שירות לקוחות','מכירות','React','Node.js',
        'הנהלת חשבונות','גיוס','שיווק דיגיטלי','אנגלית','ריתוך','חשמל','לוגיסטיקה',
        'ניהול מלאי','Java','AWS','עיצוב גרפי','קופירייטינג','QA','DevOps',
        'תמיכה טכנית','CRM','SAP','ניהול פרויקטים','אנליזה','בקרת איכות',
        'נהיגה','מלגזה']::text[]                                                        as skills,
  array['מפתח/ת תוכנה','מנהל/ת חשבונות','נציג/ת שירות','מנהל/ת מכירות','איש/אשת מכירות',
        'מהנדס/ת','טכנאי/ת','מנהל/ת פרויקטים','אנליסט/ית','מעצב/ת','מנהל/ת שיווק',
        'נציג/ת תמיכה','מחסנאי/ת','נהג/ת','ראש צוות','QA','DevOps','מנהל/ת מוצר',
        'רכז/ת גיוס','יועץ/ת']::text[]                                                  as titles,
  array['טכנולוגיות','מערכות','פתרונות','תעשיות','שירותים','גלובל','דיגיטל','אחזקות',
        'הנדסה','ייעוץ','לוגיסטיקה','רשת','מדיה','פיננסים','בריאות']::text[]             as cbases,
  array['בע״מ','גרופ','ישראל','טק','שירותים']::text[]                                    as csuffix,
  array['AllJobs','דרושים','JobMaster','LinkedIn','Indeed','Glassdoor','הפניה']::text[] as sources,
  array['software','engineering','finance','sales_marketing','customer_service',
        'industry','construction','logistics','healthcare','education',
        'hr_admin','management','other']::text[]                                        as fields,
  array['full_time','full_time','full_time','part_time','temporary','contract','student']::text[] as scopes,
  array['open','open','open','open','on_hold','filled','closed','draft']::text[]        as jstages,
  array['new','new','new','screening','screening','initial_call','submitted_to_client',
        'interview','offer','hired','rejected','rejected','withdrawn']::text[]          as astages;

-- קיצור לבחירת איבר אקראי ממערך.
-- (נכתב inline בכל שאילתה; אין CREATE FUNCTION כדי לא לגעת בסכימה.)

-- ---------- צוותים ----------
insert into app.teams (name)
select 'צוות ' || g from generate_series(1, :n_teams) g;

-- ---------- מגייסים ----------
insert into app.employees (full_name, email, role, team_id)
select (fn)[1+floor(random()*array_length(fn,1))::int] || ' ' ||
       (ln)[1+floor(random()*array_length(ln,1))::int],
       'seed.rec.' || g || '@seed.test', 'recruiter',
       null::uuid
  from generate_series(1, :n_employees) g, _cat;
-- שיוך צוות אקראי (ב-UPDATE נפרד כדי לא לסבך את ה-INSERT עם מערך ה-ids).
update app.employees e
   set team_id = t.ids[1+floor(random()*array_length(t.ids,1))::int]
  from (select array_agg(id) ids from app.teams) t
 where e.email like 'seed.rec.%';

-- ---------- חברות + הסכם זהה ----------
insert into app.companies (name, status, owner_employee_id, business_id)
select (cbases)[1+floor(random()*array_length(cbases,1))::int] || ' ' ||
       (csuffix)[1+floor(random()*array_length(csuffix,1))::int] || ' ' || g,
       'active',
       emp.ids[1+floor(random()*array_length(emp.ids,1))::int],
       'C' || lpad(g::text, 7, '0')
  from generate_series(1, :n_companies) g, _cat,
       (select array_agg(id) ids from app.employees) emp;

-- הסכם זהה לכל החברות (כפי שמסרה הלקוחה): אותה עמלה/אחריות/תשלומים.
insert into app.agreements
  (company_id, version, commission_pct, commission_base, warranty_days,
   installments, payment_terms_days, valid_from)
select id, 1, 8.333, 'monthly', 90, 1, 30, current_date - 400
  from app.companies;

-- ---------- משרות (עם דרישות ותחום) ----------
insert into app.jobs
  (company_id, title, internal_description, must_have, nice_to_have,
   salary_min, salary_max, location, employment_scope, field, headcount,
   recruiter_id, stage, opened_at, created_by)
select comp.ids[1+floor(random()*array_length(comp.ids,1))::int],
       (titles)[1+floor(random()*array_length(titles,1))::int],
       'משרה סינתטית לבדיקות עומס.',
       'חובה: ' || (skills)[1+floor(random()*array_length(skills,1))::int] || ', ' ||
                   (skills)[1+floor(random()*array_length(skills,1))::int],
       'יתרון: ' || (skills)[1+floor(random()*array_length(skills,1))::int],
       (8000 + floor(random()*12)*1000)::numeric,
       (20000 + floor(random()*10)*1000)::numeric,
       (cities)[1+floor(random()*array_length(cities,1))::int],
       ((scopes)[1+floor(random()*array_length(scopes,1))::int])::app.employment_scope,
       ((fields)[1+floor(random()*array_length(fields,1))::int])::app.job_field,
       1 + floor(random()*3)::int,
       emp.ids[1+floor(random()*array_length(emp.ids,1))::int],
       ((jstages)[1+floor(random()*array_length(jstages,1))::int])::app.job_stage,
       current_date - floor(random()*400)::int,
       emp.ids[1+floor(random()*array_length(emp.ids,1))::int]
  from generate_series(1, :n_jobs) g, _cat,
       (select array_agg(id) ids from app.companies) comp,
       (select array_agg(id) ids from app.employees) emp;

-- ---------- פרסום ציבורי לחלק מהמשרות הפתוחות ----------
insert into app.job_publications
  (job_id, slug, public_title, public_body, expose_company_name,
   public_location, status, published_at)
select j.id,
       'seed-' || row_number() over () || '-' || substr(md5(j.id::text), 1, 6),
       j.title, 'הצטרפו אלינו לתפקיד ' || j.title || '.', (random() < 0.5),
       j.location, 'published',
       now() - (floor(random()*120) || ' days')::interval
  from app.jobs j
 where j.stage = 'open' and random() < 0.6;

-- ---------- מועמדים (כולל "ישנים") ----------
insert into app.candidates
  (full_name, phone_normalized, phone_raw, email, years_experience, skills,
   desired_salary, availability, source, owner_employee_id, created_at)
select (fn)[1+floor(random()*array_length(fn,1))::int] || ' ' ||
       (ln)[1+floor(random()*array_length(ln,1))::int],
       '9725' || lpad(g::text, 8, '0'),
       '05' || lpad(g::text, 8, '0'),
       'cand.' || g || '@seed.test',
       round((random()*20)::numeric, 1),
       array[(skills)[1+floor(random()*array_length(skills,1))::int],
             (skills)[1+floor(random()*array_length(skills,1))::int],
             (skills)[1+floor(random()*array_length(skills,1))::int],
             (skills)[1+floor(random()*array_length(skills,1))::int]],
       (8000 + floor(random()*22)*1000)::numeric,
       (array['מיידית','חודש','חודשיים','גמיש'])[1+floor(random()*4)::int],
       (sources)[1+floor(random()*array_length(sources,1))::int],
       emp.ids[1+floor(random()*array_length(emp.ids,1))::int],
       now() - (floor(random()*1400) || ' days')::interval   -- עד ~4 שנים אחורה
  from generate_series(1, :n_candidates) g, _cat,
       (select array_agg(id) ids from app.employees) emp;

-- ---------- קורות-חיים: רשומת מסמך לכל מועמד ----------
insert into app.documents
  (candidate_id, kind, storage_path, file_name, mime_type, size_bytes, file_check)
select c.id, 'cv', 'seed/' || c.id || '/cv.pdf',
       'cv-' || left(c.id::text, 8) || '.pdf', 'application/pdf',
       (50000 + floor(random()*350000))::bigint, 'passed'
  from app.candidates c;

-- ---------- ניתוח AI מדומה (כאילו analyze-cv כבר רץ) ----------
insert into app.document_analyses
  (document_id, status, engine_version, extracted, summary, cost_usd, completed_at)
select d.id, 'done', 'seed',
       jsonb_build_object(
         'full_name', c.full_name, 'email', c.email, 'phone', c.phone_raw,
         'years_experience', c.years_experience, 'skills', to_jsonb(c.skills),
         'desired_salary', c.desired_salary, 'availability', c.availability),
       'מועמד/ת עם ' || coalesce(c.years_experience, 0) ||
         ' שנות ניסיון, מיומנויות: ' || array_to_string(c.skills, ', ') || '.',
       0, now()
  from app.documents d
  join app.candidates c on c.id = d.candidate_id;

-- ---------- מועמדות אחת לכל מועמד, מול משרה פתוחה אקראית ----------
insert into app.applications
  (candidate_id, job_id, recruiter_id, source, stage, stage_changed_at, created_at)
select c.id,
       oj.ids[1+floor(random()*array_length(oj.ids,1))::int],
       emp.ids[1+floor(random()*array_length(emp.ids,1))::int],
       c.source,
       ((astages)[1+floor(random()*array_length(astages,1))::int])::app.application_stage,
       c.created_at, c.created_at
  from app.candidates c, _cat,
       (select array_agg(id) ids from app.jobs where stage in ('open','on_hold')) oj,
       (select array_agg(id) ids from app.employees) emp;

commit;

-- סטטיסטיקות מתכנן — חשוב לבדיקת ביצועים אמינה.
analyze;

-- ---------- סיכום ----------
select 'companies'  as tbl, count(*) from app.companies
union all select 'agreements',        count(*) from app.agreements
union all select 'teams',             count(*) from app.teams
union all select 'employees',         count(*) from app.employees
union all select 'jobs',              count(*) from app.jobs
union all select 'job_publications',  count(*) from app.job_publications
union all select 'candidates',        count(*) from app.candidates
union all select 'documents',         count(*) from app.documents
union all select 'document_analyses', count(*) from app.document_analyses
union all select 'applications',      count(*) from app.applications
order by 1;
