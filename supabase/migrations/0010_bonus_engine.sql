-- 0010 · מנוע בונוסים והתחשבנות: חישוב חודשי לפי מדרגות + קיזוזים.
-- מעל finance.calc_bonus_lines המאומתת. הרשאה: מנהלת בלבד.

-- חישוב/רענון בונוס חודשי למגייס. אחד לכל (מגייס, חודש); ניתן להרצה חוזרת.
create or replace function app.compute_monthly_bonus(p_employee uuid, p_month date)
returns uuid language plpgsql security definer set search_path = app, finance, public as $$
declare
  m0 date := date_trunc('month', p_month)::date;
  m1 date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  pl finance.bonus_plans%rowtype; calc_id uuid; inp finance.bonus_input[];
begin
  if not app.is_manager() then raise exception 'רק מנהלת מחשבת בונוסים'; end if;
  select * into pl from finance.bonus_plans
   where employee_id = p_employee and valid_from <= m1 and (valid_to is null or valid_to >= m0)
   order by version desc limit 1;
  if pl.id is null then raise exception 'אין תוכנית תגמול בתוקף לחודש זה'; end if;

  select array_agg((p.id, p.expected_commission, p.verified_start_date)::finance.bonus_input
                   order by p.verified_start_date, p.id)
    into inp
  from finance.placements p
  where p.recruiter_id = p_employee
    and p.verified_start_date between m0 and m1
    and p.status in ('working_warranty','approved');

  insert into finance.bonus_calculations (employee_id, period_month, plan_id, plan_version, status)
  values (p_employee, m0, pl.id, pl.version, 'draft')
  on conflict (employee_id, period_month) do update
    set plan_id = excluded.plan_id, plan_version = excluded.plan_version, updated_at = now()
  returning id into calc_id;

  -- שורות מהשמות (שומרים שורות קיזוז שליליות)
  delete from finance.bonus_calculation_lines where calculation_id = calc_id and placement_id is not null;
  insert into finance.bonus_calculation_lines (calculation_id, placement_id, expected_commission, tier, pct, amount)
  select calc_id, l.placement_id, l.base, l.tier, l.pct, l.amount
  from finance.calc_bonus_lines(pl.metric, pl.target_a, pl.target_b, pl.pct_tier_1, pl.pct_tier_2, coalesce(inp,'{}'::finance.bonus_input[])) l
  where l.placement_id is not null;

  update finance.bonus_calculations c set
    metric_value = case when pl.metric = 'placements_count'
                        then (select count(*)::numeric from unnest(coalesce(inp,'{}'::finance.bonus_input[])))
                        else (select coalesce(sum(commission),0) from unnest(coalesce(inp,'{}'::finance.bonus_input[])) as u(placement_id uuid, commission numeric, start_date date)) end,
    total_amount = (select coalesce(sum(amount),0) from finance.bonus_calculation_lines where calculation_id = calc_id)
  where c.id = calc_id;
  return calc_id;
end $$;

-- שינוי מצב חישוב (טיוטה -> לבדיקה -> מאושר -> שולם)
create or replace function app.set_bonus_status(p_calc uuid, p_status text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  if p_status not in ('draft','review','approved','paid') then raise exception 'סטטוס לא חוקי'; end if;
  update finance.bonus_calculations set status = p_status::finance.bonus_status,
    approved_by = case when p_status='approved' then app.current_employee() else approved_by end,
    approved_at = case when p_status='approved' then now() else approved_at end,
    paid_at = case when p_status='paid' then now() else paid_at end,
    updated_at = now()
  where id = p_calc;
end $$;

-- פתיחת הצעת קיזוז בכישלון השמה
create or replace function app.open_clawback(p_placement uuid)
returns uuid language plpgsql security definer set search_path = app, finance, public as $$
declare v_emp uuid; v_amt numeric; v_calc uuid; v_id uuid;
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  select recruiter_id into v_emp from finance.placements where id = p_placement;
  select l.amount, l.calculation_id into v_amt, v_calc
    from finance.bonus_calculation_lines l where l.placement_id = p_placement
    order by l.amount desc limit 1;
  insert into finance.clawback_proposals (placement_id, calculation_id, employee_id, proposed_amount, status)
  values (p_placement, v_calc, v_emp, coalesce(v_amt,0), 'open')
  on conflict (placement_id) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- החלטת מנהלת על קיזוז. offset/spread מזריקים שורות שליליות לחודשים הבאים.
create or replace function app.decide_clawback(
  p_id uuid, p_treatment text, p_amount numeric, p_spread_months integer, p_defer date, p_reason text)
returns void language plpgsql security definer set search_path = app, finance, public as $$
declare cb finance.clawback_proposals%rowtype; m date := date_trunc('month', now())::date; i integer; per numeric; calc_id uuid;
begin
  if not app.is_manager() then raise exception 'רק מנהלת'; end if;
  if p_treatment not in ('offset','spread','deferred','none') then raise exception 'טיפול לא חוקי'; end if;
  select * into cb from finance.clawback_proposals where id = p_id;
  if cb.id is null then raise exception 'הצעה לא נמצאה'; end if;

  update finance.clawback_proposals set treatment = p_treatment::finance.clawback_treatment,
    decided_amount = p_amount, spread_months = p_spread_months, defer_until = p_defer, reason = p_reason,
    status = case when p_treatment='deferred' then 'open' else 'decided' end,
    decided_by = app.current_employee(), decided_at = now()
  where id = p_id;

  if p_treatment in ('offset','spread') then
    for i in 0 .. greatest(0, coalesce(p_spread_months,1) - 1) loop
      per := round(p_amount / greatest(1, coalesce(case when p_treatment='spread' then p_spread_months else 1 end,1)), 2);
      insert into finance.bonus_calculations (employee_id, period_month, status)
      values (cb.employee_id, (date_trunc('month', now()) + make_interval(months => i))::date, 'draft')
      on conflict (employee_id, period_month) do update set updated_at = now()
      returning id into calc_id;
      insert into finance.bonus_calculation_lines (calculation_id, clawback_id, amount, note)
      values (calc_id, p_id, -per, 'קיזוז השמה שנכשלה');
      update finance.bonus_calculations c set total_amount =
        (select coalesce(sum(amount),0) from finance.bonus_calculation_lines where calculation_id = calc_id) where c.id = calc_id;
    end loop;
    update finance.clawback_proposals set status = 'closed' where id = p_id;
  end if;
end $$;

grant execute on function app.compute_monthly_bonus(uuid,date), app.set_bonus_status(uuid,text),
  app.open_clawback(uuid), app.decide_clawback(uuid,text,numeric,integer,date,text) to authenticated;
