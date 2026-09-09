-- 0009 · גישת אפליקציה לסכמת הכספים + פונקציות עסקיות אמינות.
-- כללי העסק (עמלה, לוח תשלומים) חיים במסד ולא בדפדפן, לשמירת מקור אמת אחד.

-- ---------- חשיפה והרשאות ----------
grant usage on schema finance to authenticated;
grant select, insert, update, delete on all tables in schema finance to authenticated;
grant usage, select on all sequences in schema finance to authenticated;
alter default privileges in schema finance grant select, insert, update, delete on tables to authenticated;

-- ---------- RLS: כספים למנהלת; מגייס רואה רק את שלו ----------
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'finance' loop
    execute format('alter table finance.%I enable row level security', t);
    execute format('drop policy if exists mgr_all on finance.%I', t);
    execute format('create policy mgr_all on finance.%I for all to authenticated using (app.is_manager()) with check (app.is_manager())', t);
  end loop;
end $$;

-- מגייס: צפייה בהשמות שלו ובחישוב הבונוס שלו בלבד
drop policy if exists own_placements on finance.placements;
create policy own_placements on finance.placements for select to authenticated
  using (recruiter_id = app.current_employee());
drop policy if exists own_bonus on finance.bonus_calculations;
create policy own_bonus on finance.bonus_calculations for select to authenticated
  using (employee_id = app.current_employee());

-- ---------- יצירת השמה ממועמדות שהתקבלה ----------
create or replace function app.create_placement(
  p_application_id uuid, p_agreement_id uuid, p_agreed_salary numeric, p_expected_start date
) returns uuid
language plpgsql security definer set search_path = app, finance, public as $$
declare
  ag app.agreements%rowtype;
  appl app.applications%rowtype;
  base numeric; expected numeric; v_id uuid; v_emp uuid;
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  select * into ag   from app.agreements  where id = p_agreement_id;
  select * into appl from app.applications     where id = p_application_id;
  if ag.id is null or appl.id is null then raise exception 'הסכם או מועמדות לא נמצאו'; end if;

  base := p_agreed_salary * (case when ag.commission_base = 'annual' then 12 else 1 end);
  expected := round(base * ag.commission_pct / 100, 2);
  v_emp := coalesce(appl.recruiter_id, app.current_employee());

  insert into finance.placements (
    application_id, company_id, recruiter_id, agreement_id, accepted_at, expected_start_date,
    agreed_salary, commission_base, commission_pct, expected_commission, warranty_days,
    status, created_by)
  select p_application_id, j.company_id, v_emp, p_agreement_id, current_date, p_expected_start,
    p_agreed_salary, ag.commission_base, ag.commission_pct, expected, ag.warranty_days,
    'pending_start', app.current_employee()
  from app.jobs j where j.id = appl.job_id
  returning id into v_id;
  return v_id;
end $$;

-- ---------- אימות תחילת עבודה ----------
create or replace function app.verify_placement_start(p_placement_id uuid, p_start date)
returns void language plpgsql security definer set search_path = app, finance, public as $$
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  update finance.placements
     set verified_start_date = p_start, status = 'working_warranty'
   where id = p_placement_id and status = 'pending_start';
end $$;

-- ---------- אישור השמה ויצירת לוח תשלומים ----------
-- אחרי תום תקופת האחריות. יוצר לוח פעם אחת (idempotent).
create or replace function app.approve_placement(p_placement_id uuid)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare
  pl finance.placements%rowtype; ag app.agreements%rowtype; sched_id uuid; r record;
begin
  if not app.is_manager() then raise exception 'רק מנהלת מאשרת השמה'; end if;
  select * into pl from finance.placements where id = p_placement_id;
  if pl.id is null then raise exception 'השמה לא נמצאה'; end if;
  if pl.verified_start_date is null then raise exception 'יש לאמת תחילת עבודה קודם'; end if;

  update finance.placements set status = 'approved', approved_by = app.current_employee(), approved_at = now()
   where id = p_placement_id;

  if exists (select 1 from finance.payment_schedules where placement_id = p_placement_id) then
    return; -- כבר קיים לוח
  end if;

  select * into ag from app.agreements where id = pl.agreement_id;
  insert into finance.payment_schedules (placement_id, total_amount, installments)
  values (p_placement_id, pl.expected_commission, ag.installments)
  returning id into sched_id;

  for r in select * from finance.build_schedule(pl.expected_commission, ag.installments,
                                                date_trunc('month', now())::date, ag.payment_terms_days)
  loop
    insert into finance.invoices (schedule_id, seq, amount, currency, planned_issue_date, due_date, status)
    values (sched_id, r.seq, r.amount, pl.currency, r.planned_issue_date, r.due_date, 'planned');
  end loop;
end $$;

-- ---------- כישלון השמה ----------
create or replace function app.fail_placement(p_placement_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
begin
  if not app.is_staff() then raise exception 'לא מורשה'; end if;
  if p_status not in ('not_started','left_in_warranty','cancelled') then
    raise exception 'סטטוס סיום לא חוקי';
  end if;
  update finance.placements set status = p_status::finance.placement_status, ended_reason = p_reason
   where id = p_placement_id;
  -- ביטול חיובים שטרם הופקו
  update finance.invoices i set status = 'cancelled'
   from finance.payment_schedules s
   where s.id = i.schedule_id and s.placement_id = p_placement_id and i.status = 'planned';
end $$;

grant execute on function app.create_placement(uuid,uuid,numeric,date),
  app.verify_placement_start(uuid,date), app.approve_placement(uuid),
  app.fail_placement(uuid,text,text) to authenticated;
