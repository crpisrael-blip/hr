-- ניקוי הדאטה הניסיונית בלבד — משאיר נתונים אמיתיים (למשל חשבון המנהלת
-- שיצרתם ידנית בסטייג׳ינג) על כנם. מזוהה לפי סמנים ייחודיים של ה-seed.
--
-- מחיקת המועמדים הסינתטיים מגלגלת אוטומטית (on delete cascade) את המסמכים,
-- ניתוחי ה-AI, ההסכמות והמועמדויות שלהם.
\set ON_ERROR_STOP on
begin;
delete from app.candidates where email like 'cand.%@seed.test';
delete from app.jobs      where company_id in (select id from app.companies where business_id like 'C%');
delete from app.companies where business_id like 'C%';
delete from app.employees where email like 'seed.rec.%';
delete from app.teams     where name like 'צוות %';
commit;

select 'candidates' as tbl, count(*) from app.candidates
union all select 'jobs', count(*) from app.jobs
union all select 'companies', count(*) from app.companies
order by 1;
