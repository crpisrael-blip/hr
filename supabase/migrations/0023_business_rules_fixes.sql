-- 0023 · תיקוני כללי עסק ופונקציות RPC חדשות.
-- מטפל בממצאי הביקורת H4, H5, H6, H7, H8, H12, M4, M5, M6, M7, M10, L4,
-- ומוסיף את חמש הפונקציות שהאפליקציות נכתבות מולן.

-- ============================================================================
-- 0. עזרי זמן ואזור זמן (M10)
-- ============================================================================
-- date_trunc('month', now()) מחושב ב-UTC. בין 00:00 ל-03:00 שעון ישראל ביום
-- הראשון בחודש זה מחזיר את החודש הקודם. כל תאריך עסקי נגזר מכאן.
create or replace function app.today_il() returns date
language sql stable as $$ select (now() at time zone 'Asia/Jerusalem')::date $$;

create or replace function app.month_start_il(p_when date default null) returns date
language sql stable as $$ select date_trunc('month', coalesce(p_when, app.today_il()))::date $$;

-- ============================================================================
-- 1. הגבלת קצב להגשות ציבוריות (H3)
-- ============================================================================
-- פונקציית הקצה שומרת רק גיבוב SHA-256 של ה-IP עם מלח, לעולם לא כתובת גולמית.
create table if not exists app.public_submission_log (
  id         bigserial primary key,
  ip_hash    text        not null,
  created_at timestamptz not null default now()
);
create index if not exists public_submission_log_ip
  on app.public_submission_log (ip_hash, created_at desc);
alter table app.public_submission_log enable row level security;
revoke all on app.public_submission_log from authenticated, anon, public;
revoke all on sequence app.public_submission_log_id_seq from authenticated, anon, public;
grant all on app.public_submission_log to service_role;
grant all on sequence app.public_submission_log_id_seq to service_role;

-- בודק ורושם באותה פעולה. מחזיר false כשעברו את המכסה.
create or replace function app.public_submission_allowed(
  p_ip_hash text, p_limit integer default 5, p_window_minutes integer default 10)
returns boolean
language plpgsql security definer set search_path = app, public as $$
declare v_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) < 16 then
    return true;   -- אין ממה לגזור מגביל; לא חוסמים הגשה אמיתית
  end if;
  delete from app.public_submission_log where created_at < now() - interval '1 day';
  select count(*) into v_count from app.public_submission_log
   where ip_hash = p_ip_hash
     and created_at > now() - make_interval(mins => greatest(1, p_window_minutes));
  if v_count >= greatest(1, p_limit) then return false; end if;
  insert into app.public_submission_log (ip_hash) values (p_ip_hash);
  return true;
end $$;

-- ============================================================================
-- 2. מניעת משימת אוטומציה כפולה על אותה ישות (M5)
-- ============================================================================
-- האינדקס הקודם כלל parent_task_id בלבד, ושתי שורות עם NULL אינן מתנגשות —
-- ולכן כל הגשה חוזרת יצרה משימה נוספת. מוסיפים מפתח ישות מפורש.
alter table app.tasks add column if not exists automation_entity_id uuid;
drop index if exists app.tasks_open_automation_uniq;
create unique index if not exists tasks_open_automation_uniq
  on app.tasks (automation_rule_id, coalesce(automation_entity_id, parent_task_id))
  where automation_rule_id is not null
    and coalesce(automation_entity_id, parent_task_id) is not null
    and status in ('open','in_progress');
create index if not exists tasks_automation_entity on app.tasks (automation_entity_id);

-- ============================================================================
-- 3. מכונת מצבים להשמה (H7, H8, M10)
-- ============================================================================
-- יצירת השמה: ההסכם חייב להיות של אותה חברה, בתוקף ליום הקבלה, והמועמדות
-- חייבת להיות בשלב "התקבל".
create or replace function app.create_placement(
  p_application_id uuid, p_agreement_id uuid, p_agreed_salary numeric, p_expected_start date
) returns uuid
language plpgsql security definer set search_path = app, finance, public as $$
declare
  ag   app.agreements%rowtype;
  appl app.applications%rowtype;
  v_job_company uuid;
  v_today date := app.today_il();
  base numeric; expected numeric; v_id uuid; v_emp uuid;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  if p_agreed_salary is null or p_agreed_salary <= 0 then
    raise exception 'שכר מוסכם חייב להיות גדול מאפס';
  end if;

  select * into ag   from app.agreements   where id = p_agreement_id;
  select * into appl from app.applications where id = p_application_id;
  if ag.id is null or appl.id is null then raise exception 'הסכם או מועמדות לא נמצאו'; end if;

  if appl.stage <> 'hired' then
    raise exception 'אפשר ליצור השמה רק ממועמדות בשלב "התקבל" (השלב הנוכחי: %)', appl.stage;
  end if;

  select j.company_id into v_job_company from app.jobs j where j.id = appl.job_id;
  if v_job_company is null then raise exception 'למועמדות אין משרה תקפה'; end if;
  if ag.company_id <> v_job_company then
    raise exception 'ההסכם שייך לחברה אחרת מזו של המשרה';
  end if;
  if ag.valid_from > v_today or (ag.valid_to is not null and ag.valid_to < v_today) then
    raise exception 'ההסכם אינו בתוקף ליום הקבלה';
  end if;

  base     := p_agreed_salary * (case when ag.commission_base = 'annual' then 12 else 1 end);
  expected := round(base * ag.commission_pct / 100, 2);
  v_emp    := coalesce(appl.recruiter_id, app.current_employee());
  if v_emp is null then raise exception 'אין מגייס זכאי להשמה'; end if;

  insert into finance.placements_private (
    application_id, company_id, recruiter_id, agreement_id, accepted_at, expected_start_date,
    agreed_salary, commission_base, commission_pct, expected_commission, warranty_days,
    status, created_by)
  values (p_application_id, v_job_company, v_emp, p_agreement_id, v_today, p_expected_start,
    p_agreed_salary, ag.commission_base, ag.commission_pct, expected, ag.warranty_days,
    'pending_start', app.current_employee())
  returning id into v_id;
  return v_id;
end $$;

-- אימות תחילת עבודה: רק מהמצב 'ממתין לתחילה'.
create or replace function app.verify_placement_start(p_placement_id uuid, p_start date)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare v_status finance.placement_status;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  select status into v_status from finance.placements_private where id = p_placement_id;
  if v_status is null then raise exception 'השמה לא נמצאה'; end if;
  if v_status <> 'pending_start' then
    raise exception 'אפשר לאמת תחילת עבודה רק להשמה שממתינה לתחילה (המצב הנוכחי: %)', v_status;
  end if;
  update finance.placements_private
     set verified_start_date = p_start, status = 'working_warranty'
   where id = p_placement_id;
end $$;

-- אישור השמה: רק אחרי שתקופת האחריות הסתיימה בפועל, ורק ממצב "בעבודה".
create or replace function app.approve_placement(p_placement_id uuid)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare
  pl finance.placements_private%rowtype; ag app.agreements%rowtype; sched_id uuid; r record;
begin
  if not app.is_manager() then raise exception 'רק מנהלת מאשרת השמה'; end if;
  select * into pl from finance.placements_private where id = p_placement_id;
  if pl.id is null then raise exception 'השמה לא נמצאה'; end if;
  if pl.status = 'approved' then return; end if;   -- כבר מאושרת
  if pl.status <> 'working_warranty' then
    raise exception 'אפשר לאשר רק השמה בתקופת אחריות פעילה (המצב הנוכחי: %)', pl.status;
  end if;
  if pl.verified_start_date is null then raise exception 'יש לאמת תחילת עבודה קודם'; end if;
  if pl.warranty_ends_on is null or pl.warranty_ends_on > app.today_il() then
    raise exception 'תקופת האחריות טרם הסתיימה (סיום צפוי: %)', pl.warranty_ends_on;
  end if;

  update finance.placements_private
     set status = 'approved', approved_by = app.current_employee(), approved_at = now()
   where id = p_placement_id;

  if exists (select 1 from finance.payment_schedules where placement_id = p_placement_id) then
    return; -- כבר קיים לוח
  end if;

  select * into ag from app.agreements where id = pl.agreement_id;
  insert into finance.payment_schedules (placement_id, total_amount, installments)
  values (p_placement_id, pl.expected_commission, ag.installments)
  returning id into sched_id;

  for r in select * from finance.build_schedule(pl.expected_commission, ag.installments,
                                                app.month_start_il(), ag.payment_terms_days)
  loop
    insert into finance.invoices (schedule_id, seq, amount, currency, planned_issue_date, due_date, status)
    values (sched_id, r.seq, r.amount, pl.currency, r.planned_issue_date, r.due_date, 'planned');
  end loop;
end $$;

-- פתיחת הצעת קיזוז — הגרסה הפנימית, נקראת גם אוטומטית מכישלון השמה.
-- H6: הסכום הוא סכום כל שורות הבונוס של אותה השמה, לא השורה הגדולה.
create or replace function app.open_clawback_auto(p_placement uuid)
returns uuid
language plpgsql security definer set search_path = app, finance, public as $$
declare v_emp uuid; v_amt numeric; v_calc uuid; v_id uuid;
begin
  select recruiter_id into v_emp from finance.placements_private where id = p_placement;
  if v_emp is null then return null; end if;

  select sum(l.amount), l.calculation_id into v_amt, v_calc
    from finance.bonus_calculation_lines l
   where l.placement_id = p_placement
   group by l.calculation_id
   order by sum(l.amount) desc
   limit 1;

  if v_amt is null then return null; end if;   -- לא שולם בונוס על ההשמה

  insert into finance.clawback_proposals (placement_id, calculation_id, employee_id, proposed_amount, status)
  values (p_placement, v_calc, v_emp, greatest(0, v_amt), 'open')
  on conflict (placement_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from finance.clawback_proposals where placement_id = p_placement;
  end if;
  return v_id;
end $$;

create or replace function app.open_clawback(p_placement uuid)
returns uuid
language plpgsql security definer set search_path = app, finance, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  return app.open_clawback_auto(p_placement);
end $$;

-- כישלון השמה: מגייס רשאי לסמן כישלון לפני האישור בלבד; אחרי אישור — מנהלת.
-- פותח אוטומטית הצעת קיזוז כשנרשם בונוס על ההשמה (אפיון, תרחיש 3).
create or replace function app.fail_placement(p_placement_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare v_status finance.placement_status;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  if p_status not in ('not_started','left_in_warranty','cancelled') then
    raise exception 'סטטוס סיום לא חוקי';
  end if;
  if coalesce(nullif(trim(coalesce(p_reason,'')), ''), '') = '' then
    raise exception 'חובה לציין סיבת סיום';
  end if;

  select status into v_status from finance.placements_private where id = p_placement_id;
  if v_status is null then raise exception 'השמה לא נמצאה'; end if;
  if v_status in ('not_started','left_in_warranty','cancelled') then
    raise exception 'ההשמה כבר סגורה (המצב הנוכחי: %)', v_status;
  end if;
  if v_status = 'approved' and not app.is_manager() then
    raise exception 'השמה מאושרת נסגרת בידי מנהלת בלבד';
  end if;
  if v_status not in ('pending_start','working_warranty','approved') then
    raise exception 'מעבר לא חוקי ממצב %', v_status;
  end if;

  update finance.placements_private
     set status = p_status::finance.placement_status, ended_reason = p_reason
   where id = p_placement_id;

  -- ביטול חיובים שטרם הופקו
  update finance.invoices i set status = 'cancelled'
   from finance.payment_schedules s
   where s.id = i.schedule_id and s.placement_id = p_placement_id and i.status = 'planned';

  -- הצעת קיזוז אוטומטית (אינה מקזזת דבר עד להחלטת המנהלת)
  perform app.open_clawback_auto(p_placement_id);
end $$;

-- ============================================================================
-- 4. מנוע בונוסים (H5, M10)
-- ============================================================================
-- עיגול בסוף החישוב ולא בכל שורה (אפיון, סעיף הבונוסים). השורות עצמן
-- נשמרות ב-numeric(14,2) לצורך תצוגה, אך הסכום נגזר מהערכים המלאים.
create or replace function finance.calc_bonus_lines(
  p_metric   finance.bonus_metric,
  p_target_a numeric,
  p_target_b numeric,
  p_pct1     numeric,
  p_pct2     numeric,
  p_input    finance.bonus_input[]
) returns table (placement_id uuid, tier smallint, pct numeric, base numeric, amount numeric)
language plpgsql immutable as $$
declare
  r        finance.bonus_input;
  idx      integer := 0;
  cum      numeric := 0;
  top      numeric;
  seg      numeric;
begin
  foreach r in array coalesce(p_input, '{}'::finance.bonus_input[]) loop
    idx := idx + 1;

    if p_metric = 'placements_count' then
      placement_id := r.placement_id;
      base         := r.commission;
      if    idx <= p_target_a then tier := 0; pct := 0;
      elsif idx <= p_target_b then tier := 1; pct := p_pct1;
      else                         tier := 2; pct := p_pct2;
      end if;
      amount := r.commission * pct / 100;
      return next;

    else -- commission_sum
      top := cum + r.commission;

      seg := greatest(0, least(top, p_target_a) - cum);
      if seg > 0 then
        placement_id := r.placement_id; tier := 0; pct := 0;
        base := seg; amount := 0; return next;
      end if;

      seg := greatest(0, least(top, p_target_b) - greatest(cum, p_target_a));
      if seg > 0 then
        placement_id := r.placement_id; tier := 1; pct := p_pct1;
        base := seg; amount := seg * p_pct1 / 100; return next;
      end if;

      seg := greatest(0, top - greatest(cum, p_target_b));
      if seg > 0 then
        placement_id := r.placement_id; tier := 2; pct := p_pct2;
        base := seg; amount := seg * p_pct2 / 100; return next;
      end if;

      cum := top;
    end if;
  end loop;
end $$;

-- חישוב/רענון בונוס חודשי.
--  · מסרב לדרוס חישוב שכבר יצא מטיוטה (H5) — אחרת מחיקת שורות מאפסת סכום ששולם.
--  · אינו מסנן השמות שנכשלו: הן נשארות בחישוב ומסומנות בהערה (אפיון).
create or replace function app.compute_monthly_bonus(p_employee uuid, p_month date)
returns uuid language plpgsql security definer set search_path = app, finance, public as $$
declare
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  pl finance.bonus_plans%rowtype;
  calc_id uuid; inp finance.bonus_input[];
  v_status finance.bonus_status;
  v_lines numeric; v_clawbacks numeric;
begin
  if not app.is_manager() then raise exception 'רק מנהלת מחשבת בונוסים'; end if;

  select c.status into v_status from finance.bonus_calculations c
   where c.employee_id = p_employee and c.period_month = m0;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'קיים חישוב במצב "%" לחודש זה. יש להחזיר אותו לטיוטה לפני חישוב מחדש.', v_status;
  end if;

  select * into pl from finance.bonus_plans
   where employee_id = p_employee and valid_from <= m1 and (valid_to is null or valid_to >= m0)
   order by version desc limit 1;
  if pl.id is null then raise exception 'אין תוכנית תגמול בתוקף לחודש זה'; end if;

  select array_agg((p.id, p.expected_commission, p.verified_start_date)::finance.bonus_input
                   order by p.verified_start_date, p.id) into inp
  from finance.placements_private p
  where p.recruiter_id = p_employee
    and p.verified_start_date between m0 and m1;

  insert into finance.bonus_calculations (employee_id, period_month, plan_id, plan_version, status)
  values (p_employee, m0, pl.id, pl.version, 'draft')
  on conflict (employee_id, period_month) do update
    set plan_id = excluded.plan_id, plan_version = excluded.plan_version, updated_at = now()
  returning id into calc_id;

  -- שורות מהשמות (שומרים שורות קיזוז שליליות)
  delete from finance.bonus_calculation_lines where calculation_id = calc_id and placement_id is not null;
  insert into finance.bonus_calculation_lines (calculation_id, placement_id, expected_commission, tier, pct, amount)
  select calc_id, l.placement_id, l.base, l.tier, l.pct, round(l.amount, 2)
  from finance.calc_bonus_lines(pl.metric, pl.target_a, pl.target_b, pl.pct_tier_1, pl.pct_tier_2,
                                coalesce(inp,'{}'::finance.bonus_input[])) l
  where l.placement_id is not null;

  -- סימון השמות שנכשלו: נשארות בחישוב ומסומנות (אפיון, תרחיש 3).
  update finance.bonus_calculation_lines l
     set note = 'ההשמה נכשלה — נדרשת החלטת קיזוז'
    from finance.placements_private p
   where l.calculation_id = calc_id and l.placement_id = p.id
     and p.status in ('not_started','left_in_warranty','cancelled');

  -- עיגול בסוף: הסכום נגזר מהערכים המלאים ולא מסכום שורות מעוגלות.
  select round(coalesce(sum(l.amount), 0), 2) into v_lines
    from finance.calc_bonus_lines(pl.metric, pl.target_a, pl.target_b, pl.pct_tier_1, pl.pct_tier_2,
                                  coalesce(inp,'{}'::finance.bonus_input[])) l
   where l.placement_id is not null;
  select coalesce(sum(amount), 0) into v_clawbacks
    from finance.bonus_calculation_lines
   where calculation_id = calc_id and clawback_id is not null;

  update finance.bonus_calculations c set
    metric_value = case when pl.metric = 'placements_count'
                        then (select count(*)::numeric from unnest(coalesce(inp,'{}'::finance.bonus_input[])))
                        else (select coalesce(sum(u.commission),0) from unnest(coalesce(inp,'{}'::finance.bonus_input[])) as u) end,
    total_amount = v_lines + v_clawbacks
  where c.id = calc_id;
  return calc_id;
end $$;

-- מצב חישוב: אפשר לחזור אחורה לתיקון, אך לא מ"שולם" (M10).
create or replace function app.set_bonus_status(p_calc uuid, p_status text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare v_cur finance.bonus_status;
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  if p_status not in ('draft','review','approved','paid') then raise exception 'סטטוס לא חוקי'; end if;
  select status into v_cur from finance.bonus_calculations where id = p_calc;
  if v_cur is null then raise exception 'חישוב לא נמצא'; end if;
  if v_cur = 'paid' and p_status <> 'paid' then
    raise exception 'חישוב ששולם אינו חוזר למצב קודם';
  end if;
  update finance.bonus_calculations set status = p_status::finance.bonus_status,
    approved_by = case when p_status='approved' then app.current_employee() else approved_by end,
    approved_at = case when p_status='approved' then now() else approved_at end,
    paid_at = case when p_status='paid' then now() else paid_at end,
    updated_at = now()
  where id = p_calc;
end $$;

-- החלטת מנהלת על קיזוז (H4, M10).
--  · ה-case שהניב 'open'/'decided' הוסק כ-text ולכן כל קריאה נכשלה: נוסף cast.
--  · 'none' נסגר סופית (אפיון: ויתור מודע), 'deferred' נשאר פתוח עם תאריך יעד.
--  · שארית העיגול בפריסה נכנסת לחודש האחרון, כמו ב-build_schedule.
create or replace function app.decide_clawback(
  p_id uuid, p_treatment text, p_amount numeric, p_spread_months integer, p_defer date, p_reason text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare
  cb finance.clawback_proposals%rowtype;
  m0 date := app.month_start_il();
  months integer; i integer; per numeric; paid numeric := 0; amt numeric; calc_id uuid;
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  if p_treatment not in ('offset','spread','deferred','none') then raise exception 'טיפול לא חוקי'; end if;
  select * into cb from finance.clawback_proposals where id = p_id;
  if cb.id is null then raise exception 'הצעה לא נמצאה'; end if;
  if cb.status = 'closed' then raise exception 'ההצעה כבר נסגרה'; end if;

  if p_treatment = 'deferred' and p_defer is null then
    raise exception 'דחייה מחייבת תאריך יעד';
  end if;
  if p_treatment = 'spread' and coalesce(p_spread_months, 0) < 1 then
    raise exception 'פריסה מחייבת מספר חודשים';
  end if;

  amt := round(coalesce(p_amount, cb.proposed_amount, 0), 2);

  update finance.clawback_proposals set
    treatment      = p_treatment::finance.clawback_treatment,
    decided_amount = amt,
    spread_months  = case when p_treatment = 'spread' then p_spread_months else null end,
    defer_until    = case when p_treatment = 'deferred' then p_defer else null end,
    reason         = p_reason,
    status         = (case when p_treatment = 'deferred' then 'open' else 'decided' end)::finance.clawback_status,
    decided_by     = app.current_employee(),
    decided_at     = now()
  where id = p_id;

  if p_treatment in ('offset','spread') then
    months := case when p_treatment = 'spread' then greatest(1, coalesce(p_spread_months, 1)) else 1 end;
    per    := round(amt / months, 2);
    for i in 0 .. months - 1 loop
      -- שארית העיגול לחודש האחרון, כך שסכום הקיזוזים שווה בדיוק לסכום שהוחלט.
      if i = months - 1 then per := amt - paid; end if;
      paid := paid + per;

      insert into finance.bonus_calculations (employee_id, period_month, status)
      values (cb.employee_id, (m0 + make_interval(months => i))::date, 'draft')
      on conflict (employee_id, period_month) do update set updated_at = now()
      returning id into calc_id;

      insert into finance.bonus_calculation_lines (calculation_id, clawback_id, amount, note)
      values (calc_id, p_id, -per, 'קיזוז השמה שנכשלה');

      update finance.bonus_calculations c set total_amount =
        (select coalesce(sum(amount),0) from finance.bonus_calculation_lines where calculation_id = calc_id)
      where c.id = calc_id;
    end loop;
    update finance.clawback_proposals set status = 'closed' where id = p_id;
  elsif p_treatment = 'none' then
    -- ויתור מודע: ההצעה נסגרת ואינה חוזרת לרשימת הפתוחות (אפיון).
    update finance.clawback_proposals set status = 'closed' where id = p_id;
  end if;
end $$;

-- ============================================================================
-- 5. מעברי שלב במועמדות (SPEC:590, M9, H9)
-- ============================================================================
-- טבלת המעברים חיה עד היום רק בדפדפן (apps/team-app/src/lib/stages.ts).
-- כאן היא נכנסת למסד, ונאכפת גם על עדכון ישיר מ-PostgREST.
create or replace function app.allowed_stage_transition(
  p_from app.application_stage, p_to app.application_stage)
returns boolean
language sql immutable as $$
  select case
    when p_from = p_to then true
    -- שלב סופי: רק פתיחה מחדש, וחוזרים ל"סינון"
    when p_from in ('rejected','withdrawn','job_cancelled') then p_to = 'screening'
    -- קידום לשלב הבא ברצף העבודה
    when array_position(array['new','screening','initial_call','submitted_to_client',
                              'interview','offer','hired']::app.application_stage[], p_to)
       = array_position(array['new','screening','initial_call','submitted_to_client',
                              'interview','offer','hired']::app.application_stage[], p_from) + 1 then true
    -- סגירה מכל שלב עבודה שאינו "התקבל"
    when p_to in ('rejected','withdrawn','job_cancelled') and p_from <> 'hired' then true
    else false
  end
$$;

-- BEFORE: אכיפת המעבר ותחזוקת stage_changed_at (לא מהדפדפן).
create or replace function app.applications_stage_guard()
returns trigger language plpgsql set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    if not app.allowed_stage_transition(old.stage, new.stage) then
      raise exception 'מעבר שלב לא חוקי: % -> %', old.stage, new.stage;
    end if;
    new.stage_changed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists applications_stage_guard on app.applications;
create trigger applications_stage_guard before update on app.applications
  for each row execute function app.applications_stage_guard();

-- AFTER: רישום ההיסטוריה מהמסד בלבד (הדפדפן כבר אינו רשאי לכתוב לטבלה).
create or replace function app.applications_log_stage()
returns trigger language plpgsql security definer set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    insert into app.application_stage_history (application_id, from_stage, to_stage, reason, changed_by)
    values (new.id, old.stage, new.stage,
            nullif(coalesce(current_setting('app.stage_note', true), ''), ''),
            app.current_employee());
  end if;
  return null;
end $$;
drop trigger if exists applications_log_stage on app.applications;
create trigger applications_log_stage after update on app.applications
  for each row execute function app.applications_log_stage();

-- ה-RPC שהאפליקציה קוראת: בודק הרשאה והיקף, מעדכן ורושם היסטוריה.
create or replace function app.set_application_stage(
  p_application_id uuid, p_stage app.application_stage, p_note text default null)
returns void
language plpgsql security definer set search_path = app, public as $$
declare a app.applications%rowtype;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  select * into a from app.applications where id = p_application_id;
  if a.id is null then raise exception 'מועמדות לא נמצאה'; end if;
  if not app.owner_in_scope(app.effective_scope('applications','edit'),
                            app.current_employee(), app.my_team(), a.recruiter_id) then
    raise exception 'המועמדות אינה בהיקף ההרשאה שלך';
  end if;
  if a.stage = p_stage then return; end if;
  if not app.allowed_stage_transition(a.stage, p_stage) then
    raise exception 'מעבר שלב לא חוקי: % -> %', a.stage, p_stage;
  end if;

  perform set_config('app.stage_note', coalesce(p_note, ''), true);
  update app.applications
     set stage = p_stage,
         close_reason = case when p_stage::text in ('rejected','withdrawn','job_cancelled')
                             then coalesce(p_note, close_reason) else close_reason end
   where id = p_application_id;
  perform set_config('app.stage_note', '', true);
end $$;

-- ============================================================================
-- 6. משימות (RPC ללוח ולכרטיס)
-- ============================================================================
-- מיפוי בין מצב המשימה למצב האישי של מקבל המשימה.
create or replace function app.task_personal_of(p_status app.task_status)
returns app.assignee_status language sql immutable as $$
  select case p_status
    when 'done'        then 'done'
    when 'in_progress' then 'in_progress'
    when 'cancelled'   then 'removed'
    else 'pending' end::app.assignee_status
$$;

-- שינוי מצב המשימה עצמה (גרירה בלוח). מיישר את המצב האישי כדי שהלוח
-- והכרטיס לא יציגו דברים סותרים.
create or replace function app.set_task_status(p_task_id uuid, p_status app.task_status)
returns void
language plpgsql security definer set search_path = app, public as $$
declare v_cur app.task_status;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  select status into v_cur from app.tasks where id = p_task_id;
  if v_cur is null then raise exception 'משימה לא נמצאה'; end if;

  update app.tasks
     set status = p_status,
         completed_at = case when p_status = 'done' then coalesce(completed_at, now()) else null end
   where id = p_task_id;

  if p_status = 'done' then
    update app.task_assignees
       set personal_status = 'done', done_at = coalesce(done_at, now())
     where task_id = p_task_id and personal_status <> 'removed';
  elsif p_status in ('open','in_progress') then
    update app.task_assignees
       set personal_status = app.task_personal_of(p_status), done_at = null
     where task_id = p_task_id and personal_status = 'done';
  end if;
end $$;

-- סימון אישי: מעדכן את המצב האישי ומחשב מחדש את מצב המשימה לפי כלל ההשלמה.
create or replace function app.set_my_task_status(p_task_id uuid, p_status app.task_status)
returns app.task_status
language plpgsql security definer set search_path = app, public as $$
declare
  v_me uuid := app.current_employee();
  t app.tasks%rowtype;
  v_active integer; v_done integer; v_new app.task_status;
begin
  if v_me is null then raise exception 'לא מורשה'; end if;
  select * into t from app.tasks where id = p_task_id;
  if t.id is null then raise exception 'משימה לא נמצאה'; end if;
  if not exists (select 1 from app.task_assignees where task_id = p_task_id and employee_id = v_me) then
    raise exception 'המשימה אינה מוקצית לך';
  end if;

  update app.task_assignees
     set personal_status = app.task_personal_of(p_status),
         done_at = case when p_status = 'done' then now() else null end
   where task_id = p_task_id and employee_id = v_me;

  select count(*) filter (where personal_status <> 'removed'),
         count(*) filter (where personal_status = 'done')
    into v_active, v_done
  from app.task_assignees where task_id = p_task_id;

  v_new := t.status;
  if t.status not in ('cancelled') then
    if t.completion_rule = 'any_assignee' and v_done >= 1 then v_new := 'done';
    elsif t.completion_rule = 'all_assignees' and v_active > 0 and v_done = v_active then v_new := 'done';
    elsif v_done > 0 or p_status = 'in_progress' then v_new := 'in_progress';
    else v_new := 'open';
    end if;
  end if;

  if v_new is distinct from t.status then
    update app.tasks
       set status = v_new,
           completed_at = case when v_new = 'done' then coalesce(completed_at, now()) else null end
     where id = p_task_id;
  end if;
  return v_new;
end $$;

-- ============================================================================
-- 7. טופס ההגשה באתר
-- ============================================================================
-- דגל is_site_apply הוא יחיד (אינדקס ייחודי חלקי). כיבוי והדלקה באותה
-- טרנזקציה, אחרת עדכון מהדפדפן נכשל על האינדקס.
create or replace function app.set_site_apply_form(p_template_id uuid)
returns void
language plpgsql security definer set search_path = app, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת קובעת את טופס ההגשה באתר'; end if;
  update app.form_templates set is_site_apply = false where is_site_apply;
  if p_template_id is not null then
    update app.form_templates set is_site_apply = true where id = p_template_id;
    if not found then raise exception 'תבנית לא נמצאה'; end if;
  end if;
end $$;

-- ============================================================================
-- 8. מחיקה מבוקרת של מועמד (M4)
-- ============================================================================
-- אין מחיקה פיזית עם cascade. הרשומה נשארת כשלד סטטיסטי, ה-PII נמחק,
-- והפעולה מתועדת בבקשת מחיקה וביומן הביקורת.
create or replace function app.anonymize_candidate(p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = app, auth, public as $$
declare v_docs integer;
begin
  if not app.is_manager() then raise exception 'רק מנהלת מבצעת מחיקה מבוקרת'; end if;
  if not exists (select 1 from app.candidates where id = p_candidate_id) then
    raise exception 'מועמד לא נמצא';
  end if;

  select count(*) into v_docs from app.documents where candidate_id = p_candidate_id;
  delete from app.documents where candidate_id = p_candidate_id;
  update app.conversation_messages m
     set body = 'ההודעה נמחקה לבקשת המועמד'
    from app.conversations c
   where c.id = m.conversation_id and c.candidate_id = p_candidate_id;

  update app.candidates set
    full_name        = 'מועמד/ת שהוסר/ה',
    phone_normalized = null,
    phone_raw        = null,
    email            = null,
    skills           = null,
    preferences      = '{}'::jsonb,
    custom           = '{}'::jsonb,
    desired_salary   = null,
    availability     = null,
    user_id          = null,
    anonymized_at    = now()
  where id = p_candidate_id;

  insert into app.deletion_requests (candidate_id, channel, verified_by, status, completed_at,
                                     what_removed, what_kept)
  values (p_candidate_id, 'system', app.current_employee(), 'done', now(),
          format('שם, טלפון, דוא"ל, כישורים, העדפות ו-%s מסמכים', v_docs),
          'מועמדויות והשמות ללא פרטים מזהים, לצורכי דיווח והתחשבנות');

  insert into audit.events (actor_id, actor_label, action, entity_type, entity_id, changes)
  values (auth.uid(),
          (select full_name from app.employees where id = app.current_employee()),
          'anonymize', 'app.candidates', p_candidate_id::text,
          jsonb_build_object('documents_removed', v_docs));
end $$;

-- ============================================================================
-- 9. אזור המועמד — הקשחה (H12, M6, M7)
-- ============================================================================
-- H12: קישור לפי דוא"ל מותר רק לרשומה שנוצרה בידי הצוות או בייבוא.
-- רשומה שנוצרה מהאתר הציבורי (source='website') מכילה דוא"ל שאיש לא אימת,
-- ולכן תוקף שמגיש עם הטלפון של הקורבן והדוא"ל שלו לא יקבל עליה בעלות.
create or replace function app.claim_candidate_profile()
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_email text; v_phone text; v_norm text; v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'לא מחובר'; end if;

  if exists (select 1 from app.employees e where e.user_id = v_uid) then
    raise exception 'חשבון עובד אינו יכול להיות מועמד';
  end if;

  select id into v_id from app.candidates
   where user_id = v_uid and anonymized_at is null limit 1;
  if v_id is not null then return v_id; end if;

  select email, phone into v_email, v_phone from auth.users where id = v_uid;
  v_norm := app.normalize_phone(v_phone);

  select id into v_id from app.candidates c
   where c.user_id is null and c.anonymized_at is null
     and (
       (v_norm is not null and c.phone_normalized = v_norm)
       or (v_email is not null and lower(c.email) = lower(v_email)
           and coalesce(c.source, '') not in ('website','public_apply'))
     )
   order by (v_norm is not null and c.phone_normalized = v_norm) desc
   limit 1;

  if v_id is not null then
    update app.candidates set user_id = v_uid where id = v_id;
  end if;
  return v_id;
end $$;

-- M6: נתיב אחסון נבדק בפועל (ולא רק בתחילית), שם הקובץ מוגבל.
create or replace function app.add_my_document(
  p_kind app.document_kind, p_storage_path text, p_file_name text, p_mime text, p_size bigint)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_max_mb numeric; v_allowed text[]; v_ver int; v_id uuid; v_name text;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  if p_kind not in ('cv', 'cover_letter', 'certificate', 'other') then
    raise exception 'סוג מסמך לא מורשה להעלאה עצמית';
  end if;
  if p_size is null or p_size <= 0 then raise exception 'קובץ ריק'; end if;

  v_name := left(regexp_replace(coalesce(p_file_name, 'file'), '[\r\n\t]', '', 'g'), 200);
  if v_name = '' then v_name := 'file'; end if;

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

  -- הנתיב חייב להיות בדיוק בתיקיית המועמד, ללא '..' וללא תווי בקרה.
  if p_storage_path is null
     or p_storage_path <> (v_cand::text || '/' || regexp_replace(p_storage_path, '^[^/]*/', ''))
     or p_storage_path like '%..%'
     or p_storage_path ~ '[[:cntrl:]]'
     or length(p_storage_path) > 500 then
    raise exception 'נתיב אחסון לא תקין';
  end if;

  -- האובייקט חייב להתקיים בפועל (רק כשסכמת storage זמינה, כלומר על Supabase).
  if to_regclass('storage.objects') is not null then
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'candidate-docs' and o.name = p_storage_path) then
      raise exception 'הקובץ לא נמצא באחסון';
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_ver
    from app.documents where candidate_id = v_cand and kind = p_kind;

  insert into app.documents
    (candidate_id, kind, version, storage_path, file_name, mime_type, size_bytes, uploaded_by, file_check)
  values
    (v_cand, p_kind, v_ver, p_storage_path, v_name, p_mime, p_size, auth.uid(), 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- M7: הודעה מוגבלת באורך ובקצב.
create or replace function app.send_my_message(p_application_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_conv uuid; v_recruiter uuid; v_id uuid; v_body text; v_recent integer;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  v_body := trim(coalesce(p_body, ''));
  if v_body = '' then raise exception 'הודעה ריקה'; end if;
  if length(v_body) > 4000 then raise exception 'ההודעה ארוכה מדי (עד 4000 תווים)'; end if;
  if not coalesce((select value = 'true'::jsonb from app.settings where key = 'candidate_area.chat_enabled'), true) then
    raise exception 'השיחה מושבתת';
  end if;

  select count(*) into v_recent
    from app.conversations c
    join app.conversation_messages m on m.conversation_id = c.id
   where c.candidate_id = v_cand and m.sender_type = 'candidate'
     and m.created_at > now() - interval '10 minutes';
  if v_recent >= 20 then raise exception 'נשלחו יותר מדי הודעות. נסו שוב בעוד כמה דקות.'; end if;

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
  values (v_conv, 'candidate', auth.uid(), v_body)
  returning id into v_id;

  update app.conversations set last_message_at = now(), status = 'open' where id = v_conv;
  return v_id;
end $$;

-- M7: ערכים לא תקינים מקבלים הודעה בעברית במקום שגיאת cast של Postgres;
-- דוא"ל נערך רק כשהוא זהה לדוא"ל שהמועמד אימת בכניסה.
create or replace function app.update_my_profile(p jsonb)
returns jsonb
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_ed text[]; v_salary numeric; v_email text; v_auth_email text;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;

  select array(select jsonb_array_elements_text(value)) into v_ed
    from app.settings where key = 'candidate_area.editable_fields';
  v_ed := coalesce(v_ed, array[]::text[]);

  if 'desired_salary' = any(v_ed) and p ? 'desired_salary' then
    if nullif(p->>'desired_salary', '') is null then
      v_salary := null;
    elsif p->>'desired_salary' ~ '^[0-9]+(\.[0-9]{1,2})?$' then
      v_salary := (p->>'desired_salary')::numeric;
    else
      raise exception 'שכר מבוקש חייב להיות מספר';
    end if;
  end if;

  if 'email' = any(v_ed) and p ? 'email' then
    v_email := lower(nullif(trim(p->>'email'), ''));
    select lower(u.email) into v_auth_email from auth.users u where u.id = auth.uid();
    if v_email is not null and v_email is distinct from v_auth_email then
      raise exception 'אפשר לעדכן רק את הדוא"ל שאומת בכניסה. לשינוי כתובת יש לפנות למגייס.';
    end if;
  end if;

  update app.candidates c set
    full_name = case
      when 'full_name' = any(v_ed) and nullif(p->>'full_name', '') is not null
      then left(p->>'full_name', 120) else c.full_name end,
    email = case
      when 'email' = any(v_ed) and p ? 'email' and v_email is not null
      then v_email else c.email end,
    availability = case
      when 'availability' = any(v_ed) and p ? 'availability'
      then left(nullif(p->>'availability', ''), 120) else c.availability end,
    desired_salary = case
      when 'desired_salary' = any(v_ed) and p ? 'desired_salary'
      then v_salary else c.desired_salary end,
    preferences = case
      when 'preferences' = any(v_ed) and p ? 'preferences'
      then coalesce(p->'preferences', '{}'::jsonb) else c.preferences end
  where c.id = v_cand;

  return app.my_profile();
end $$;

-- ============================================================================
-- 10. הרשאות הרצה (חזרה על מדיניות 0022 גם לפונקציות שנוצרו כאן)
-- ============================================================================
revoke execute on all functions in schema app     from public, anon;
revoke execute on all functions in schema finance from public, anon;
grant  execute on all functions in schema app     to authenticated, service_role;
grant  execute on all functions in schema finance to authenticated, service_role;

grant execute on function app.form_open(text)          to anon;
grant execute on function app.form_save(text, jsonb)   to anon;
grant execute on function app.form_submit(text, jsonb) to anon;
grant execute on function app.site_apply_form()        to anon;

-- פונקציות שאינן נקודת קצה ללקוח.
revoke execute on function app.link_employee(text, text, app.user_role) from public, anon, authenticated;
revoke execute on function app.open_clawback_auto(uuid) from public, anon, authenticated;
revoke execute on function app.public_submission_allowed(text, integer, integer) from public, anon, authenticated;
grant  execute on function app.public_submission_allowed(text, integer, integer) to service_role;

-- חמש הפונקציות שהאפליקציות נכתבות מולן — למשתמש מחובר בלבד.
grant execute on function app.set_site_apply_form(uuid)                                    to authenticated;
grant execute on function app.set_task_status(uuid, app.task_status)                       to authenticated;
grant execute on function app.set_my_task_status(uuid, app.task_status)                    to authenticated;
grant execute on function app.set_application_stage(uuid, app.application_stage, text)     to authenticated;
grant execute on function app.anonymize_candidate(uuid)                                    to authenticated;

notify pgrst, 'reload schema';
