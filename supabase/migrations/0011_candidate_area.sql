-- 0011 · האזור האישי של המועמד (my.hr): קישור חשבון, פרופיל, מועמדויות,
-- מסמכים ושיחה. אזור אמון נפרד: למועמד אין גישת טבלה ישירה — מדיניות
-- staff_all (0008) מחזירה false עבורו. כל הגישה עוברת דרך פונקציות
-- SECURITY DEFINER הממוקדות תמיד לרשומת המועמד של המשתמש המחובר בלבד.

-- ---------- נרמול טלפון (זהה ללוגיקה בפונקציית ההגשה) ----------
create or replace function app.normalize_phone(raw text)
returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') as v)
  select case
    when (select v from d) = ''            then null
    when (select v from d) like '+972%'    then '+972' || regexp_replace(substr((select v from d), 5), '^0', '')
    when (select v from d) like '972%'      then '+972' || regexp_replace(substr((select v from d), 4), '^0', '')
    when (select v from d) like '0%'        then '+972' || substr((select v from d), 2)
    else (select v from d)
  end
$$;

-- ---------- מיהו המועמד המחובר ----------
create or replace function app.current_candidate()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select id from app.candidates
  where user_id = auth.uid() and anonymized_at is null
  limit 1
$$;

-- קישור חשבון ה-Auth לרשומת המועמד בכניסה הראשונה.
-- ההתאמה לפי טלפון (מפתח הכפילות) ואם אין — לפי דוא"ל. רק רשומה לא מקושרת.
-- מחזיר null אם אין רשומת מועמד (המשתמש עדיין לא הגיש למשרה).
create or replace function app.claim_candidate_profile()
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_email text; v_phone text; v_norm text; v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'לא מחובר'; end if;

  select id into v_id from app.candidates
   where user_id = v_uid and anonymized_at is null limit 1;
  if v_id is not null then return v_id; end if;

  select email, phone into v_email, v_phone from auth.users where id = v_uid;
  v_norm := app.normalize_phone(v_phone);

  select id into v_id from app.candidates
   where user_id is null and anonymized_at is null
     and (
       (v_norm  is not null and phone_normalized = v_norm)
       or (v_email is not null and lower(email) = lower(v_email))
     )
   order by (v_norm is not null and phone_normalized = v_norm) desc
   limit 1;

  if v_id is not null then
    update app.candidates set user_id = v_uid where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------- פרופיל ----------
create or replace function app.my_profile()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select case when c.id is null then null else jsonb_build_object(
    'id',               c.id,
    'full_name',        c.full_name,
    'email',            c.email,
    'phone',            c.phone_raw,
    'availability',     c.availability,
    'desired_salary',   c.desired_salary,
    'years_experience', c.years_experience,
    'skills',           to_jsonb(c.skills),
    'preferences',      c.preferences,
    'editable_fields',  (select value from app.settings where key = 'candidate_area.editable_fields')
  ) end
  from (select app.current_candidate() as id) x
  left join app.candidates c on c.id = x.id
$$;

-- עדכון עצמי — רק שדות שהוגדרו כניתנים לעריכה (app.settings).
create or replace function app.update_my_profile(p jsonb)
returns jsonb
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_ed text[];
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;

  select array(select jsonb_array_elements_text(value)) into v_ed
    from app.settings where key = 'candidate_area.editable_fields';
  v_ed := coalesce(v_ed, array[]::text[]);

  update app.candidates c set
    full_name = case
      when 'full_name' = any(v_ed) and nullif(p->>'full_name', '') is not null
      then p->>'full_name' else c.full_name end,
    email = case
      when 'email' = any(v_ed) and p ? 'email'
      then nullif(p->>'email', '') else c.email end,
    availability = case
      when 'availability' = any(v_ed) and p ? 'availability'
      then nullif(p->>'availability', '') else c.availability end,
    desired_salary = case
      when 'desired_salary' = any(v_ed) and p ? 'desired_salary'
      then (nullif(p->>'desired_salary', ''))::numeric else c.desired_salary end,
    preferences = case
      when 'preferences' = any(v_ed) and p ? 'preferences'
      then coalesce(p->'preferences', '{}'::jsonb) else c.preferences end
  where c.id = v_cand;

  return app.my_profile();
end $$;

-- ---------- מועמדויות (ממופות דרך חשיפת השלבים) ----------
-- שלב לא-חשוף מקבל תווית ניטרלית; שם השלב הפנימי לעולם לא מגיע למועמד.
create or replace function app.my_applications()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',                 a.id,
    'job_title',          j.title,
    'exposed',            coalesce(se.exposed, false),
    'status_label',       case when se.exposed then coalesce(se.candidate_label, 'בתהליך') else 'בטיפול' end,
    'status_explanation', case when se.exposed then se.explanation else null end,
    'is_closed',          a.stage in ('rejected', 'withdrawn', 'job_cancelled'),
    'applied_at',         a.created_at,
    'updated_at',         a.stage_changed_at
  ) order by a.stage_changed_at desc), '[]'::jsonb)
  from app.applications a
  join app.jobs j on j.id = a.job_id
  left join app.stage_exposure se on se.stage = a.stage
  where a.candidate_id = app.current_candidate()
$$;

create or replace function app.my_application(p_id uuid)
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select case when a.id is null then null else jsonb_build_object(
    'id',                 a.id,
    'job_title',          j.title,
    'exposed',            coalesce(se.exposed, false),
    'status_label',       case when se.exposed then coalesce(se.candidate_label, 'בתהליך') else 'בטיפול' end,
    'status_explanation', case when se.exposed then se.explanation else null end,
    'is_closed',          a.stage in ('rejected', 'withdrawn', 'job_cancelled'),
    'applied_at',         a.created_at,
    'updated_at',         a.stage_changed_at,
    'interviews',         case when se.exposed and a.stage = 'interview' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'scheduled_at', iv.scheduled_at,
          'location',     iv.location,
          'status',       iv.status,
          'participants', case when iv.expose_interviewer then to_jsonb(iv.participants) else null end
        ) order by iv.scheduled_at), '[]'::jsonb)
        from app.interviews iv
        where iv.application_id = a.id and iv.status <> 'cancelled')
      else '[]'::jsonb end
  ) end
  from app.applications a
  join app.jobs j on j.id = a.job_id
  left join app.stage_exposure se on se.stage = a.stage
  where a.id = p_id and a.candidate_id = app.current_candidate()
$$;

-- ---------- מסמכים ----------
-- המועמד רואה רק מסמכים שהוא רשאי לראות (לא ערכות הגשה/סיכומים פנימיים).
create or replace function app.my_documents()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           d.id,
    'kind',         d.kind,
    'file_name',    d.file_name,
    'storage_path', d.storage_path,
    'size_bytes',   d.size_bytes,
    'mime_type',    d.mime_type,
    'version',      d.version,
    'created_at',   d.created_at
  ) order by d.created_at desc), '[]'::jsonb)
  from app.documents d
  where d.candidate_id = app.current_candidate()
    and d.kind in ('cv', 'cover_letter', 'certificate', 'other')
$$;

-- רישום מסמך אחרי העלאה ל-Storage. אוכף סוג/גודל לפי הגדרות הארגון,
-- ומוודא שהנתיב שייך למועמד עצמו.
create or replace function app.add_my_document(
  p_kind app.document_kind, p_storage_path text, p_file_name text, p_mime text, p_size bigint)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_max_mb numeric; v_allowed text[]; v_ver int; v_id uuid;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  if p_kind not in ('cv', 'cover_letter', 'certificate', 'other') then
    raise exception 'סוג מסמך לא מורשה להעלאה עצמית';
  end if;
  if p_size is null or p_size <= 0 then raise exception 'קובץ ריק'; end if;

  select (value #>> '{}')::numeric into v_max_mb from app.settings where key = 'files.max_size_mb';
  select array(select jsonb_array_elements_text(value)) into v_allowed
    from app.settings where key = 'files.allowed_mime';

  if v_allowed is not null and array_length(v_allowed, 1) is not null
     and not (p_mime = any(v_allowed)) then
    raise exception 'סוג הקובץ אינו נתמך';
  end if;
  if v_max_mb is not null and p_size > v_max_mb * 1024 * 1024 then
    raise exception 'הקובץ גדול מהמותר';
  end if;
  if p_storage_path not like (v_cand::text || '/%') then
    raise exception 'נתיב אחסון לא תקין';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver
    from app.documents where candidate_id = v_cand and kind = p_kind;

  insert into app.documents
    (candidate_id, kind, version, storage_path, file_name, mime_type, size_bytes, uploaded_by, file_check)
  values
    (v_cand, p_kind, v_ver, p_storage_path, p_file_name, p_mime, p_size, auth.uid(), 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- ---------- שיחה עם המגייס ----------
create or replace function app.my_messages(p_application_id uuid)
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',         m.id,
    'from_me',    m.sender_type = 'candidate',
    'body',       m.body,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  from app.conversations cv
  join app.conversation_messages m on m.conversation_id = cv.id
  where cv.application_id = p_application_id
    and cv.candidate_id = app.current_candidate()
$$;

create or replace function app.send_my_message(p_application_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_conv uuid; v_recruiter uuid; v_id uuid;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  if coalesce(nullif(trim(p_body), ''), '') = '' then raise exception 'הודעה ריקה'; end if;
  if not coalesce((select value = 'true'::jsonb from app.settings where key = 'candidate_area.chat_enabled'), true) then
    raise exception 'השיחה מושבתת';
  end if;

  select a.recruiter_id into v_recruiter from app.applications a
    where a.id = p_application_id and a.candidate_id = v_cand;
  if not found then raise exception 'מועמדות לא נמצאה'; end if;

  select id into v_conv from app.conversations where application_id = p_application_id;
  if v_conv is null then
    insert into app.conversations (candidate_id, application_id, recruiter_id, last_message_at)
    values (v_cand, p_application_id, v_recruiter, now())
    returning id into v_conv;
  end if;

  insert into app.conversation_messages (conversation_id, sender_type, sender_user_id, body)
  values (v_conv, 'candidate', auth.uid(), trim(p_body))
  returning id into v_id;

  update app.conversations set last_message_at = now(), status = 'open' where id = v_conv;
  return v_id;
end $$;

-- ---------- הרשאות הרצה למשתמש מחובר ----------
grant execute on function
  app.normalize_phone(text),
  app.current_candidate(),
  app.claim_candidate_profile(),
  app.my_profile(),
  app.update_my_profile(jsonb),
  app.my_applications(),
  app.my_application(uuid),
  app.my_documents(),
  app.add_my_document(app.document_kind, text, text, text, bigint),
  app.my_messages(uuid),
  app.send_my_message(uuid, text)
to authenticated;

-- ---------- אחסון מסמכים (רק כשקיים schema של storage, כלומר על Supabase) ----------
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('candidate-docs', 'candidate-docs', false)
    on conflict (id) do nothing;

    drop policy if exists candidate_reads_own on storage.objects;
    create policy candidate_reads_own on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs'
             and (storage.foldername(name))[1] = app.current_candidate()::text);

    drop policy if exists candidate_writes_own on storage.objects;
    create policy candidate_writes_own on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs'
                  and (storage.foldername(name))[1] = app.current_candidate()::text);

    drop policy if exists staff_reads_docs on storage.objects;
    create policy staff_reads_docs on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs' and app.is_staff());
  end if;
end $$;
