-- בדיקות רגרסיה לכללי העסק שהאפיון מגדיר במפורש.
-- נכשלות ברעש: כל אי-התאמה מפילה את הקובץ.
\set ON_ERROR_STOP on

do $$
declare
  v_input finance.bonus_input[];
  v_total numeric;
  v_rows  integer;
begin
  ---------------------------------------------------------------- בונוס
  -- אפיון, תרחיש 3ב: 5 השמות ב-10,000, יעדים 2 ו-4, 5% ו-8% -> 1,800
  v_input := array[
    (gen_random_uuid(),10000,'2026-03-01')::finance.bonus_input,
    (gen_random_uuid(),10000,'2026-03-02')::finance.bonus_input,
    (gen_random_uuid(),10000,'2026-03-03')::finance.bonus_input,
    (gen_random_uuid(),10000,'2026-03-04')::finance.bonus_input,
    (gen_random_uuid(),10000,'2026-03-05')::finance.bonus_input];
  select sum(amount) into v_total
    from finance.calc_bonus_lines('placements_count',2,4,5,8,v_input);
  if v_total <> 1800 then
    raise exception 'בונוס לפי מספר השמות: התקבל %, נדרש 1800', v_total;
  end if;

  -- מדרגות שוליות ולא על כל הסכום: אחרת התוצאה הייתה 4,000
  if v_total >= 4000 then
    raise exception 'המדרגות אינן שוליות';
  end if;

  -- חודש ללא השמות מחזיר אפס שורות, לא שגיאה
  select count(*) into v_rows
    from finance.calc_bonus_lines('placements_count',2,4,5,8,'{}'::finance.bonus_input[]);
  if v_rows <> 0 then
    raise exception 'חודש ריק החזיר % שורות', v_rows;
  end if;

  -- מדד סכום עמלות: השמה שחוצה גבול מפוצלת יחסית
  v_input := array[
    (gen_random_uuid(),40000,'2026-03-01')::finance.bonus_input,
    (gen_random_uuid(),80000,'2026-03-02')::finance.bonus_input];
  select sum(amount) into v_total
    from finance.calc_bonus_lines('commission_sum',50000,100000,5,8,v_input);
  -- 50,000 במדרגה 1 (2,500) ועוד 20,000 במדרגה 2 (1,600)
  if v_total <> 4100 then
    raise exception 'בונוס לפי סכום עמלות: התקבל %, נדרש 4100', v_total;
  end if;
  select sum(base) into v_total
    from finance.calc_bonus_lines('commission_sum',50000,100000,5,8,v_input);
  if v_total <> 120000 then
    raise exception 'הפיצול איבד או שכפל בסיס: התקבל %, נדרש 120000', v_total;
  end if;

  ------------------------------------------------------- לוח תשלומים
  -- הסכום הכולל שווה בדיוק לעמלה גם כשהחלוקה אינה עגולה
  select sum(amount) into v_total from finance.build_schedule(10000,3,'2026-01-15',30);
  if v_total <> 10000 then
    raise exception 'לוח תשלומים לא מסתכם לעמלה: התקבל %', v_total;
  end if;
  select sum(amount) into v_total from finance.build_schedule(33333.33,7,'2026-01-01',45);
  if v_total <> 33333.33 then
    raise exception 'שארית העיגול אבדה: התקבל %', v_total;
  end if;

  -- תשלום יחיד
  select count(*) into v_rows from finance.build_schedule(5000,1,'2026-01-10',0);
  if v_rows <> 1 then
    raise exception 'תשלום יחיד יצר % שורות', v_rows;
  end if;

  -- מועד פירעון: סוף חודש ההפקה ועוד ימי התנאי, כולל חודשים באורכים שונים
  if (select due_date from finance.build_schedule(1000,1,'2026-02-03',30) )
     <> date '2026-03-30' then
    raise exception 'שוטף+30 מפברואר חושב לא נכון';
  end if;
  if (select due_date from finance.build_schedule(1000,1,'2026-01-31',0) )
     <> date '2026-01-31' then
    raise exception 'שוטף+0 מינואר חושב לא נכון';
  end if;

  -------------------------------------------------------- ערכי התחלה
  if (select count(*) from app.permission_defaults where role='recruiter' and module='invoicing' and scope<>'none') > 0 then
    raise exception 'למגייס יש גישה לחיובים כברירת מחדל';
  end if;
  if (select scope from app.permission_defaults where role='manager' and module='system_settings' and action='edit') <> 'none' then
    raise exception 'למנהלת יש עריכת הגדרות מערכת';
  end if;
  if (select count(*) from app.stage_exposure where stage in ('new','screening','initial_call') and exposed) > 0 then
    raise exception 'שלב פנימי נחשף למועמד כברירת מחדל';
  end if;
  if (select count(*) from app.automation_rules where event='warranty_ended' and is_mandatory) <> 1 then
    raise exception 'כלל סיום האחריות אינו מסומן כחובה';
  end if;

  raise notice 'כל בדיקות כללי העסק עברו';
end $$;
