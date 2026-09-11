-- בדיקות רגרסיה לאבטחה ולכללי העסק שתוקנו במיגרציות 0022–0023.
-- כל בדיקה שנכשלת מפילה את הקובץ ברעש. אותו סגנון כמו שאר קובצי הבדיקה:
-- דריסה זמנית של auth.uid() כדי לדמות משתמש מחובר; אינו רץ על Supabase.
\set ON_ERROR_STOP on

alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists phone text;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  v_mgr_uid uuid := gen_random_uuid();
  v_rec_uid uuid := gen_random_uuid();
  v_mgr uuid; v_rec uuid;
  v_co_a uuid; v_co_b uuid; v_ag_a uuid; v_ag_b uuid; v_job uuid;
  v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid;
  v_a1 uuid; v_a2 uuid; v_a3 uuid; v_a4 uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid;
  v_month date := (date_trunc('month', app.today_il()) - interval '3 months')::date;
  v_start date;
  v_calc uuid; v_cb uuid;
  v_n integer; v_num numeric; v_txt text; v_ok boolean;
begin
  v_start := v_month + 4;

  ---------------------------------------------------------------- נתוני יסוד
  insert into auth.users (id, email) values (v_mgr_uid, 'mgr@sec.test'), (v_rec_uid, 'rec@sec.test');
  insert into app.employees (user_id, full_name, email, role)
    values (v_mgr_uid, 'מנהלת בדיקה', 'mgr@sec.test', 'manager') returning id into v_mgr;
  insert into app.employees (user_id, full_name, email, role)
    values (v_rec_uid, 'מגייס בדיקה', 'rec@sec.test', 'recruiter') returning id into v_rec;

  insert into app.companies (name) values ('חברה א בע"מ') returning id into v_co_a;
  insert into app.companies (name) values ('חברה ב בע"מ') returning id into v_co_b;
  insert into app.agreements (company_id, version, commission_pct, commission_base, warranty_days,
                              installments, payment_terms_days, valid_from)
    values (v_co_a, 1, 10, 'monthly', 30, 1, 0, app.today_il() - 365) returning id into v_ag_a;
  insert into app.agreements (company_id, version, commission_pct, commission_base, warranty_days,
                              installments, payment_terms_days, valid_from)
    values (v_co_b, 1, 99, 'monthly', 30, 1, 0, app.today_il() - 365) returning id into v_ag_b;
  insert into app.jobs (company_id, title, stage, recruiter_id)
    values (v_co_a, 'מפתח/ת בדיקה', 'open', v_rec) returning id into v_job;

  insert into app.candidates (full_name, phone_normalized) values ('מועמד 1','+972500000001') returning id into v_c1;
  insert into app.candidates (full_name, phone_normalized) values ('מועמד 2','+972500000002') returning id into v_c2;
  insert into app.candidates (full_name, phone_normalized) values ('מועמד 3','+972500000003') returning id into v_c3;
  insert into app.candidates (full_name, phone_normalized) values ('מועמד 4','+972500000004') returning id into v_c4;
  insert into app.applications (candidate_id, job_id, recruiter_id, stage)
    values (v_c1, v_job, v_rec, 'hired') returning id into v_a1;
  insert into app.applications (candidate_id, job_id, recruiter_id, stage)
    values (v_c2, v_job, v_rec, 'hired') returning id into v_a2;
  insert into app.applications (candidate_id, job_id, recruiter_id, stage)
    values (v_c3, v_job, v_rec, 'hired') returning id into v_a3;
  insert into app.applications (candidate_id, job_id, recruiter_id, stage)
    values (v_c4, v_job, v_rec, 'new') returning id into v_a4;

  perform set_config('test.uid', v_mgr_uid::text, false);

  ------------------------------------------------------------ H8 · יצירת השמה
  -- הסכם של חברה אחרת נדחה
  begin
    perform app.create_placement(v_a3, v_ag_b, 10000, v_start);
    raise exception 'ASSERT: create_placement קיבלה הסכם של חברה אחרת';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%חברה אחרת%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  -- מועמדות שאינה בשלב "התקבל" נדחית
  begin
    perform app.create_placement(v_a4, v_ag_a, 10000, v_start);
    raise exception 'ASSERT: create_placement קיבלה מועמדות שאינה בשלב התקבל';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%התקבל%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  -- הסכם שפג תוקפו נדחה
  update app.agreements set valid_to = app.today_il() - 10 where id = v_ag_a;
  begin
    perform app.create_placement(v_a1, v_ag_a, 310, v_start);
    raise exception 'ASSERT: create_placement קיבלה הסכם שפג תוקפו';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%בתוקף%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;
  update app.agreements set valid_to = null where id = v_ag_a;

  -- יצירה תקינה: 310 * 10% = 31.00
  v_p1 := app.create_placement(v_a1, v_ag_a, 310, v_start);
  select expected_commission into v_num from finance.placements_private where id = v_p1;
  if v_num <> 31.00 then raise exception 'ASSERT: עמלה צפויה שגויה: %', v_num; end if;

  ------------------------------------------------------- H7 · מכונת המצבים
  -- אישור לפני אימות תחילת עבודה נדחה
  begin
    perform app.approve_placement(v_p1);
    raise exception 'ASSERT: אושרה השמה שטרם התחילה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
  end;

  perform app.verify_placement_start(v_p1, v_start);
  select status into v_txt from finance.placements_private where id = v_p1;
  if v_txt <> 'working_warranty' then raise exception 'ASSERT: אימות תחילה לא שינה מצב: %', v_txt; end if;

  -- אימות כפול נדחה
  begin
    perform app.verify_placement_start(v_p1, v_start);
    raise exception 'ASSERT: אימות תחילת עבודה פעמיים עבר';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
  end;

  -- אישור לפני תום האחריות נדחה
  v_p3 := app.create_placement(v_a3, v_ag_a, 1000, app.today_il());
  perform app.verify_placement_start(v_p3, app.today_il());
  begin
    perform app.approve_placement(v_p3);
    raise exception 'ASSERT: אושרה השמה שתקופת האחריות שלה לא הסתיימה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%האחריות טרם הסתיימה%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  -- כישלון ואז אישור: חייב להידחות (עד היום נוצרו לוח תשלומים וחיוב)
  v_p2 := app.create_placement(v_a2, v_ag_a, 1000, v_start);
  perform app.fail_placement(v_p2, 'not_started', 'המועמד לא התייצב');
  begin
    perform app.approve_placement(v_p2);
    raise exception 'ASSERT: אושרה השמה שנכשלה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%אחריות פעילה%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;
  if exists (select 1 from finance.payment_schedules where placement_id = v_p2) then
    raise exception 'ASSERT: נוצר לוח תשלומים להשמה שנכשלה';
  end if;

  -- כישלון כפול נדחה
  begin
    perform app.fail_placement(v_p2, 'cancelled', 'שוב');
    raise exception 'ASSERT: השמה סגורה נכשלה פעם נוספת';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
  end;

  ------------------------------------------------------------ H5 · מנוע הבונוסים
  insert into finance.bonus_plans (employee_id, version, metric, target_a, target_b,
                                   pct_tier_1, pct_tier_2, valid_from)
    values (v_rec, 1, 'commission_sum', 0, 15, 100, 100, app.today_il() - 365);

  v_calc := app.compute_monthly_bonus(v_rec, v_month);
  select count(*) into v_n from finance.bonus_calculation_lines
   where calculation_id = v_calc and placement_id = v_p1;
  if v_n <> 2 then raise exception 'ASSERT: השמה שחוצה מדרגה לא פוצלה לשתי שורות (%)', v_n; end if;
  select total_amount into v_num from finance.bonus_calculations where id = v_calc;
  if v_num <> 31.00 then raise exception 'ASSERT: סכום הבונוס שגוי: %', v_num; end if;

  -- חישוב שאינו טיוטה אינו נדרס
  perform app.set_bonus_status(v_calc, 'paid');
  begin
    perform app.compute_monthly_bonus(v_rec, v_month);
    raise exception 'ASSERT: חישוב ששולם חושב מחדש ונדרס';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%להחזיר אותו לטיוטה%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;
  select total_amount into v_num from finance.bonus_calculations where id = v_calc;
  if v_num <> 31.00 then raise exception 'ASSERT: סכום חישוב ששולם השתנה: %', v_num; end if;

  -- M10: אין חזרה אחורה מ"שולם"
  begin
    perform app.set_bonus_status(v_calc, 'draft');
    raise exception 'ASSERT: חישוב ששולם הוחזר לטיוטה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
  end;

  ------------------------------------------------- H6/H7 · קיזוז אוטומטי וסכומו
  perform app.fail_placement(v_p1, 'left_in_warranty', 'עזב בתקופת האחריות');
  select id, proposed_amount into v_cb, v_num from finance.clawback_proposals where placement_id = v_p1;
  if v_cb is null then raise exception 'ASSERT: כישלון השמה לא פתח הצעת קיזוז'; end if;
  if v_num <> 31.00 then
    raise exception 'ASSERT: הצעת הקיזוז על סכום שורה בודדת במקום סכום השורות: %', v_num;
  end if;
  -- app.open_clawback מחזירה את אותה הצעה ולא יוצרת שנייה
  if app.open_clawback(v_p1) <> v_cb then raise exception 'ASSERT: נפתחה הצעת קיזוז כפולה'; end if;

  -- השמה שנכשלה נשארת בחישוב ומסומנת
  update finance.bonus_calculations set status = 'draft' where id = v_calc;
  perform app.compute_monthly_bonus(v_rec, v_month);
  select count(*) into v_n from finance.bonus_calculation_lines
   where calculation_id = v_calc and placement_id = v_p1;
  if v_n <> 2 then raise exception 'ASSERT: השמה שנכשלה הושמטה מהחישוב'; end if;
  select count(*) into v_n from finance.bonus_calculation_lines
   where calculation_id = v_calc and placement_id = v_p1 and note is not null;
  if v_n <> 2 then raise exception 'ASSERT: השמה שנכשלה אינה מסומנת בחישוב'; end if;

  ------------------------------------------------------------ H4 · החלטת קיזוז
  -- כל ארבעת הטיפולים חייבים לרוץ (עד היום כל קריאה נכשלה בהמרת enum)
  perform app.decide_clawback(v_cb, 'offset', 31, null, null, 'קיזוז מלא');
  select status into v_txt from finance.clawback_proposals where id = v_cb;
  if v_txt <> 'closed' then raise exception 'ASSERT: offset לא נסגר: %', v_txt; end if;

  update finance.clawback_proposals set status = 'open', treatment = null where id = v_cb;
  perform app.decide_clawback(v_cb, 'spread', 31, 3, null, 'פריסה');
  select coalesce(sum(amount), 0) into v_num from finance.bonus_calculation_lines
   where clawback_id = v_cb and note = 'קיזוז השמה שנכשלה'
     and calculation_id in (select id from finance.bonus_calculations
                             where employee_id = v_rec and period_month >= app.month_start_il());
  -- offset (31) + spread (31) => 62 בסך הכול, ללא אגורה שאבדה בעיגול
  if v_num <> -62.00 then raise exception 'ASSERT: פריסת הקיזוז איבדה אגורה: %', v_num; end if;

  update finance.clawback_proposals set status = 'open', treatment = null where id = v_cb;
  perform app.decide_clawback(v_cb, 'deferred', 31, null, app.today_il() + 60, 'נדחה לרבעון הבא');
  select status, defer_until into v_txt, v_start from finance.clawback_proposals where id = v_cb;
  if v_txt <> 'open' then raise exception 'ASSERT: דחייה לא השאירה את ההצעה פתוחה: %', v_txt; end if;
  if v_start is null then raise exception 'ASSERT: דחייה ללא תאריך יעד'; end if;

  update finance.clawback_proposals set status = 'open', treatment = null where id = v_cb;
  perform app.decide_clawback(v_cb, 'none', 0, null, null, 'ויתור מודע');
  select status into v_txt from finance.clawback_proposals where id = v_cb;
  if v_txt <> 'closed' then raise exception 'ASSERT: ויתור לא סגר את ההצעה: %', v_txt; end if;

  ------------------------------------------------- SPEC:590 · מעברי שלב במועמדות
  begin
    perform app.set_application_stage(v_a4, 'interview', null);
    raise exception 'ASSERT: התקבל דילוג שלבים new -> interview';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%מעבר שלב לא חוקי%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  perform app.set_application_stage(v_a4, 'screening', 'ממשיכים');
  select stage into v_txt from app.applications where id = v_a4;
  if v_txt <> 'screening' then raise exception 'ASSERT: מעבר חוקי לא בוצע: %', v_txt; end if;
  select count(*) into v_n from app.application_stage_history
   where application_id = v_a4 and from_stage = 'new' and to_stage = 'screening';
  if v_n <> 1 then raise exception 'ASSERT: מעבר השלב לא נרשם בהיסטוריה'; end if;

  -- גם עדכון ישיר לטבלה (PostgREST) נדחה
  begin
    update app.applications set stage = 'hired' where id = v_a4;
    raise exception 'ASSERT: עדכון ישיר עקף את טבלת המעברים';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%מעבר שלב לא חוקי%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  -- סגירה ופתיחה מחדש
  perform app.set_application_stage(v_a4, 'rejected', 'לא מתאים');
  perform app.set_application_stage(v_a4, 'screening', 'נפתח מחדש');
  select stage into v_txt from app.applications where id = v_a4;
  if v_txt <> 'screening' then raise exception 'ASSERT: פתיחה מחדש נכשלה: %', v_txt; end if;

  ------------------------------------------------------------- C1 · link_employee
  perform set_config('test.uid', v_rec_uid::text, false);
  begin
    perform app.link_employee('rec@sec.test', 'מגייס בדיקה', 'superadmin');
    raise exception 'ASSERT: מגייס הצליח להריץ link_employee';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%שמורה למנהל על%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;

  ------------------------------------------------------- C2 · העלאת הרשאות עצמית
  begin
    update app.employees set role = 'manager' where id = v_rec;
    raise exception 'ASSERT: מגייס שינה את התפקיד של עצמו';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%שמור למנהלת בלבד%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;
  begin
    update app.employees set employment_status = 'suspended' where id = v_mgr;
    raise exception 'ASSERT: מגייס השבית עובדת אחרת';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
  end;

  -- גם מנהלת אינה יכולה להעניק מנהל על
  perform set_config('test.uid', v_mgr_uid::text, false);
  begin
    update app.employees set role = 'superadmin' where id = v_rec;
    raise exception 'ASSERT: מנהלת העניקה תפקיד מנהל על';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%רק מנהל על%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת מהצפוי: %', sqlerrm;
    end if;
  end;
  -- שינוי לגיטימי של מנהלת עובד
  update app.employees set job_title = 'מגייס בכיר' where id = v_rec;

  ------------------------------------------------------------ C3 · היקפי הרשאה
  perform set_config('test.uid', v_rec_uid::text, false);
  if app.effective_scope('candidates','edit') <> 'own' then
    raise exception 'ASSERT: היקף עריכת מועמדים למגייס אינו "שלי": %', app.effective_scope('candidates','edit');
  end if;
  if app.effective_scope('invoicing','view') <> 'none' then
    raise exception 'ASSERT: למגייס יש היקף בחיובים';
  end if;
  perform set_config('test.uid', v_mgr_uid::text, false);
  if app.effective_scope('candidates','edit') <> 'all' then
    raise exception 'ASSERT: מנהלת אינה בהיקף מלא';
  end if;
  -- שלילה פר משתמש גוברת על ברירת המחדל
  insert into app.permission_overrides (employee_id, module, action, scope, kind, granted_by, reason)
    values (v_rec, 'candidates', 'view', 'none', 'deny', v_mgr, 'בדיקה');
  perform set_config('test.uid', v_rec_uid::text, false);
  if app.effective_scope('candidates','view') <> 'none' then
    raise exception 'ASSERT: שלילה פר משתמש לא גברה';
  end if;
  -- שלילה שפג תוקפה אינה נספרת
  update app.permission_overrides set valid_until = now() - interval '1 day'
   where employee_id = v_rec and module = 'candidates' and action = 'view';
  if app.effective_scope('candidates','view') = 'none' then
    raise exception 'ASSERT: שלילה שפג תוקפה עדיין חוסמת';
  end if;
  perform set_config('test.uid', v_mgr_uid::text, false);

  ------------------------------------------------------------- H9 · יומן ביקורת
  select count(*) into v_n from audit.events
   where entity_type = 'app.employees' and action in ('insert','update');
  if v_n = 0 then raise exception 'ASSERT: שינויים בכרטיס עובד אינם נרשמים ביומן'; end if;
  update app.settings set value = '20' where key = 'files.max_size_mb';
  select count(*) into v_n from audit.events where entity_type = 'app.settings' and action = 'update';
  if v_n = 0 then raise exception 'ASSERT: שינוי הגדרה אינו נרשם ביומן'; end if;
  select updated_by into v_txt from app.settings where key = 'files.max_size_mb';
  if v_txt is null then raise exception 'ASSERT: settings.updated_by לא מולא'; end if;

  ------------------------------------------------------------- M4 · מחיקה מבוקרת
  perform app.anonymize_candidate(v_c4);
  select full_name, phone_normalized is null and email is null and anonymized_at is not null
    into v_txt, v_ok from app.candidates where id = v_c4;
  if not v_ok then raise exception 'ASSERT: אנונימיזציה לא ניקתה את פרטי הזיהוי'; end if;
  if not exists (select 1 from app.deletion_requests where candidate_id = v_c4 and status = 'done') then
    raise exception 'ASSERT: אנונימיזציה לא תיעדה בקשת מחיקה';
  end if;

  ------------------------------------------------------------------ L5 · טלפון
  if app.normalize_phone('0') is not null then
    raise exception 'ASSERT: normalize_phone("0") מחזיר מספר';
  end if;
  if app.normalize_phone('0501112233') <> '+972501112233' then
    raise exception 'ASSERT: נרמול טלפון ישראלי תקין נשבר';
  end if;
  if app.normalize_phone('050-111-22') is not null then
    raise exception 'ASSERT: מספר קצר מדי התקבל';
  end if;

  perform set_config('test.uid', '', false);
  raise notice 'כל בדיקות האבטחה וכללי העסק עברו';
end $$;

-- ---------------------------------------------------------------- אסרטות קטלוג
do $$
declare v_n integer; v_list text;
begin
  -- M3: אין טבלה ללא RLS בסכמות שהאפליקציה נוגעת בהן
  select count(*), string_agg(n.nspname || '.' || c.relname, ', ')
    into v_n, v_list
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('app','finance','audit') and c.relkind = 'r' and not c.relrowsecurity;
  if v_n > 0 then raise exception 'ASSERT: טבלאות ללא RLS: %', v_list; end if;

  -- H11: anon אינו יכול להריץ פונקציות עסקיות
  if has_function_privilege('anon', 'app.compute_monthly_bonus(uuid,date)', 'execute') then
    raise exception 'ASSERT: ל-anon יש EXECUTE על compute_monthly_bonus';
  end if;
  if has_function_privilege('anon', 'app.create_placement(uuid,uuid,numeric,date)', 'execute') then
    raise exception 'ASSERT: ל-anon יש EXECUTE על create_placement';
  end if;
  -- ארבע הפונקציות הציבוריות כן נשארות פתוחות
  if not has_function_privilege('anon', 'app.form_open(text)', 'execute') then
    raise exception 'ASSERT: form_open נחסמה ל-anon ומילוי טופס בקישור נשבר';
  end if;
  if not has_function_privilege('anon', 'app.site_apply_form()', 'execute') then
    raise exception 'ASSERT: site_apply_form נחסמה ל-anon';
  end if;

  -- C1: אין מסלול REST ל-link_employee
  if has_function_privilege('authenticated', 'app.link_employee(text,text,app.user_role)', 'execute') then
    raise exception 'ASSERT: ל-authenticated יש EXECUTE על link_employee';
  end if;

  -- H10: הטבלה עם השדות הכספיים סגורה ללקוח; התצוגה פתוחה
  if has_table_privilege('authenticated', 'finance.placements_private', 'select') then
    raise exception 'ASSERT: מגייס יכול לקרוא ישירות את טבלת ההשמות';
  end if;
  if not has_table_privilege('authenticated', 'finance.placements', 'select') then
    raise exception 'ASSERT: תצוגת ההשמות אינה נגישה לצוות';
  end if;

  -- H9: היסטוריית שלבים אינה ניתנת לכתיבה/מחיקה מהלקוח
  if has_table_privilege('authenticated', 'app.application_stage_history', 'insert')
     or has_table_privilege('authenticated', 'app.application_stage_history', 'delete') then
    raise exception 'ASSERT: הלקוח עדיין יכול לכתוב להיסטוריית השלבים';
  end if;
  if has_table_privilege('authenticated', 'audit.events', 'update')
     or has_table_privilege('authenticated', 'audit.events', 'delete') then
    raise exception 'ASSERT: יומן הביקורת ניתן לעדכון או מחיקה';
  end if;

  raise notice 'כל אסרטות הקטלוג עברו';
end $$;
