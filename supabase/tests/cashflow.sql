-- בדיקות רגרסיה לתזרים, לחיובים ולתקבולים (מיגרציה 0033).
-- כל בדיקה שנכשלת מפילה את הקובץ ברעש. אותו סגנון כמו שאר קובצי הבדיקה:
-- דריסה זמנית של auth.uid() כדי לדמות משתמש מחובר; אינו רץ על Supabase.
\set ON_ERROR_STOP on

alter table auth.users add column if not exists email text;
create or replace function auth.uid() returns uuid
  language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

do $$
declare
  v_mgr_uid uuid := gen_random_uuid();
  v_mgr  uuid; v_rec uuid;
  v_co   uuid; v_ag uuid; v_job uuid; v_cand uuid; v_app uuid;
  v_pl   uuid; v_start date := app.today_il() - 40;  -- אחריות 30 יום כבר הסתיימה, כדי לאפשר אישור
  v_expected numeric;
  v_sum  numeric; v_cnt integer; v_recv numeric;
  v_inv1 uuid; v_inv1_amt numeric; v_inv2 uuid;
begin
  ------------------------------------------------------------ נתוני יסוד
  insert into auth.users (id, email) values (v_mgr_uid, 'mgr@cash.test');
  insert into app.employees (user_id, full_name, email, role)
    values (v_mgr_uid, 'מנהלת תזרים', 'mgr@cash.test', 'manager') returning id into v_mgr;
  insert into app.employees (full_name, email, role)
    values ('מגייס תזרים', 'rec@cash.test', 'recruiter') returning id into v_rec;

  insert into app.companies (name) values ('חברת תזרים בע"מ') returning id into v_co;
  -- הסכם: 10% על שכר חודשי, 3 תשלומים, שוטף+30, אחריות 30 יום.
  insert into app.agreements (company_id, version, commission_pct, commission_base, warranty_days,
                              installments, payment_terms_days, valid_from)
    values (v_co, 1, 10, 'monthly', 30, 3, 30, app.today_il() - 365) returning id into v_ag;
  insert into app.jobs (company_id, title, stage, recruiter_id)
    values (v_co, 'מפתח/ת', 'open', v_rec) returning id into v_job;
  insert into app.candidates (full_name, phone_normalized)
    values ('מועמד תזרים', '+972500000099') returning id into v_cand;
  insert into app.applications (candidate_id, job_id, recruiter_id, stage)
    values (v_cand, v_job, v_rec, 'hired') returning id into v_app;

  perform set_config('test.uid', v_mgr_uid::text, false);

  ------------------------------------------------ יצירת השמה → עמלה צפויה 1,000
  v_pl := app.create_placement(v_app, v_ag, 10000, v_start);
  select expected_commission into v_expected from finance.placements where id = v_pl;
  if v_expected <> 1000 then
    raise exception 'עמלה צפויה שגויה: התקבל %, נדרש 1000', v_expected;
  end if;

  -------------------------------------- (1) תזרים צפוי מרגע ההשמה, לפני אישור
  select count(*), coalesce(sum(expected_amount),0), coalesce(sum(received_amount),0)
    into v_cnt, v_sum, v_recv
    from finance.cashflow where placement_id = v_pl;
  if v_cnt <> 3 then raise exception 'לפני אישור: נדרשות 3 שורות צפויות, התקבלו %', v_cnt; end if;
  if v_sum <> 1000 then raise exception 'לפני אישור: סך צפוי %, נדרש 1000', v_sum; end if;
  if v_recv <> 0 then raise exception 'לפני אישור: אין תקבולים, התקבל %', v_recv; end if;
  if exists (select 1 from finance.cashflow where placement_id = v_pl and kind <> 'projected') then
    raise exception 'לפני אישור: קיימת שורה שאינה צפויה';
  end if;

  --------------------------------- אימות תחילה — עדיין צפוי (אין עוד לוח תשלומים)
  perform app.verify_placement_start(v_pl, v_start);
  select coalesce(sum(expected_amount),0) into v_sum from finance.cashflow where placement_id = v_pl;
  if v_sum <> 1000 then raise exception 'אחרי אימות: סך צפוי %, נדרש 1000', v_sum; end if;
  if exists (select 1 from finance.cashflow where placement_id = v_pl and kind <> 'projected') then
    raise exception 'אחרי אימות: התזרים אמור להיות עדיין צפוי';
  end if;

  ------------------------------------- (2) אישור השמה → חיובים אמיתיים בתזרים
  perform app.approve_placement(v_pl);
  select count(*), coalesce(sum(expected_amount),0) into v_cnt, v_sum
    from finance.cashflow where placement_id = v_pl;
  if v_cnt <> 3 then raise exception 'אחרי אישור: נדרשים 3 חיובים, התקבלו %', v_cnt; end if;
  if v_sum <> 1000 then raise exception 'אחרי אישור: סך חיובים %, נדרש 1000', v_sum; end if;
  if exists (select 1 from finance.cashflow where placement_id = v_pl and kind <> 'invoiced') then
    raise exception 'אחרי אישור: התזרים אמור להישען על חיובים אמיתיים';
  end if;

  -------------------------------------------- (3) אישור תקבול מלא על החיוב הראשון
  select invoice_id, expected_amount into v_inv1, v_inv1_amt
    from finance.cashflow where placement_id = v_pl order by seq limit 1;
  perform app.confirm_invoice_receipt(v_inv1, null, v_start);  -- מלוא היתרה
  select received_amount into v_recv from finance.cashflow where invoice_id = v_inv1;
  if v_recv <> v_inv1_amt then
    raise exception 'תקבול מלא: התקבל %, נדרש % (סכום החיוב)', v_recv, v_inv1_amt;
  end if;
  if (select status from finance.invoices where id = v_inv1) <> 'paid' then
    raise exception 'תקבול מלא: החיוב אמור לעבור למצב "שולם"';
  end if;

  -------------------------------------------- (4) תקבול חלקי על החיוב השני
  select invoice_id into v_inv2 from finance.cashflow where placement_id = v_pl and invoice_id <> v_inv1
    order by seq limit 1;
  perform app.confirm_invoice_receipt(v_inv2, 100, v_start);
  if (select status from finance.invoices where id = v_inv2) <> 'partially_paid' then
    raise exception 'תקבול חלקי: החיוב אמור להיות "שולם חלקית"';
  end if;
  select received_amount into v_recv from finance.cashflow where invoice_id = v_inv2;
  if v_recv <> 100 then raise exception 'תקבול חלקי: התקבל %, נדרש 100', v_recv; end if;

  -- חריגה מהיתרה נדחית
  begin
    perform app.confirm_invoice_receipt(v_inv2, 999999, v_start);
    raise exception 'ASSERT: תקבול מעל היתרה לא נדחה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%עולה על היתרה%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת: %', sqlerrm;
    end if;
  end;

  ------------------------------------ (5) כישלון השמה → יוצאת מהתזרים כליל
  perform app.fail_placement(v_pl, 'left_in_warranty', 'עזב בתקופת האחריות');
  select count(*) into v_cnt from finance.cashflow where placement_id = v_pl;
  if v_cnt <> 0 then
    raise exception 'אחרי כישלון: ההשמה אמורה לצאת מהתזרים, נותרו % שורות', v_cnt;
  end if;

  ------------------------------------ הרשאה: מגייס אינו יכול לאשר תקבול
  perform set_config('test.uid', '', false);  -- ללא משתמש מחובר → לא מנהלת
  begin
    perform app.confirm_invoice_receipt(v_inv2, 10, v_start);
    raise exception 'ASSERT: אישור תקבול ללא הרשאת מנהלת לא נדחה';
  exception when others then
    if sqlerrm like 'ASSERT:%' then raise; end if;
    if sqlerrm not like '%מנהלת%' then
      raise exception 'ASSERT: נדחה מסיבה אחרת: %', sqlerrm;
    end if;
  end;

  raise notice 'כל בדיקות התזרים, החיובים והתקבולים עברו';
end $$;
