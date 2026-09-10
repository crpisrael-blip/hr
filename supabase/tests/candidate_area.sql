-- בדיקות רגרסיה לאזור המועמד (my.hr). דורסות זמנית את auth.uid() כדי
-- לדמות משתמש מחובר; זה קובץ בדיקה בלבד ואינו רץ על Supabase.
\set ON_ERROR_STOP on

-- הרחבת ה-stub של auth כך שיתמוך במה שהפונקציות של 0011 צורכות.
alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists phone text;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  v_uid  uuid := gen_random_uuid();
  v_comp uuid; v_job uuid; v_job2 uuid; v_cand uuid; v_app_hidden uuid; v_app_shown uuid;
  v_claimed uuid; v_apps jsonb; v_prof jsonb; v_msg uuid; v_docs jsonb;
begin
  -- נתוני יסוד
  insert into auth.users (id, phone) values (v_uid, '+972501112233');
  insert into app.companies (name) values ('דמו בע"מ') returning id into v_comp;
  insert into app.jobs (company_id, title, stage) values (v_comp, 'מפתח/ת', 'open') returning id into v_job;
  insert into app.jobs (company_id, title, stage) values (v_comp, 'מעצב/ת', 'open') returning id into v_job2;
  -- מועמד לא מקושר, טלפון מנורמל אחר (0501112233 -> +972501112233)
  insert into app.candidates (full_name, phone_normalized, phone_raw, email)
    values ('מועמד בדיקה', app.normalize_phone('0501112233'), '050-111-2233', 'demo@x.co')
    returning id into v_cand;
  insert into app.applications (candidate_id, job_id, stage)
    values (v_cand, v_job, 'screening') returning id into v_app_hidden;
  insert into app.applications (candidate_id, job_id, stage)
    values (v_cand, v_job2, 'interview') returning id into v_app_shown;

  -- ללא משתמש מחובר: אין פרופיל
  perform set_config('test.uid', '', false);
  if app.current_candidate() is not null then
    raise exception 'current_candidate החזיר ערך ללא משתמש מחובר';
  end if;

  -- קישור לפי טלפון
  perform set_config('test.uid', v_uid::text, false);
  v_claimed := app.claim_candidate_profile();
  if v_claimed <> v_cand then
    raise exception 'הקישור לפי טלפון נכשל: התקבל %, נדרש %', v_claimed, v_cand;
  end if;
  if app.current_candidate() <> v_cand then
    raise exception 'current_candidate לא מזהה את המועמד אחרי קישור';
  end if;

  -- מיפוי שלבים: screening -> "בטיפול" (מוסתר), interview -> תווית חשופה
  v_apps := app.my_applications();
  if jsonb_array_length(v_apps) <> 2 then
    raise exception 'my_applications החזיר % מועמדויות', jsonb_array_length(v_apps);
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_apps) e
    where (e->>'id') = v_app_hidden::text and (e->>'status_label') = 'בטיפול'
      and (e->>'exposed') = 'false') then
    raise exception 'שלב מוסתר לא מופה לתווית ניטרלית';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_apps) e
    where (e->>'id') = v_app_shown::text and (e->>'status_label') = 'ראיון'
      and (e->>'exposed') = 'true') then
    raise exception 'שלב חשוף לא הציג את התווית שהוגדרה';
  end if;

  -- שם השלב הפנימי לעולם לא דולף
  if v_apps::text like '%screening%' or v_apps::text like '%interview%' then
    raise exception 'שם שלב פנימי דלף לפלט המועמד';
  end if;

  -- עדכון עצמי: שדה מותר מתעדכן, שדה אסור לא
  v_prof := app.update_my_profile(jsonb_build_object('availability', 'מיידי', 'years_experience', 99));
  if (v_prof->>'availability') <> 'מיידי' then
    raise exception 'שדה מותר לעריכה לא התעדכן';
  end if;
  if (v_prof->>'years_experience')::numeric = 99 then
    raise exception 'שדה שאינו לעריכה עודכן';
  end if;

  -- שיחה עם המגייס
  v_msg := app.send_my_message(v_app_shown, 'שלום, האם יש עדכון?');
  if v_msg is null then raise exception 'שליחת הודעה נכשלה'; end if;
  if jsonb_array_length(app.my_messages(v_app_shown)) <> 1 then
    raise exception 'ההודעה שנשלחה לא נקראה חזרה';
  end if;

  -- מסמכים: submission_pack אינו נחשף למועמד
  insert into app.documents (candidate_id, kind, storage_path, file_name, mime_type, size_bytes)
    values (v_cand, 'cv',              v_cand||'/cv/cv.pdf',   'cv.pdf',   'application/pdf', 1000),
           (v_cand, 'submission_pack', v_cand||'/pack/p.pdf',  'pack.pdf', 'application/pdf', 2000);
  v_docs := app.my_documents();
  if jsonb_array_length(v_docs) <> 1 or v_docs::text like '%submission_pack%' then
    raise exception 'מסמך פנימי נחשף למועמד';
  end if;

  raise notice 'כל בדיקות אזור המועמד עברו';
end $$;
