-- תיקון סופי לשגיאת הבונוס: "a column definition list is redundant for a
-- function returning a named composite type".
-- הגורם: במסד קיימת גרסה ישנה של compute_monthly_bonus עם טיפוס־החזרה שגוי
-- (create or replace אינו יכול לשנות טיפוס־החזרה, ולכן ריצות מאוחרות נכשלו בשקט).
-- הפתרון: DROP מפורש ואז יצירה מחדש עם החזרת uuid, ורענון מטמון הסכימה.

-- מחיקת כל גרסה קיימת של הפונקציה, ללא תלות בחתימת הארגומנטים או טיפוס־ההחזרה,
-- כדי לחסל בוודאות גרסה תקועה עם טיפוס־החזרה שגוי.
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where pronamespace = 'app'::regnamespace and proname = 'compute_monthly_bonus'
  loop execute 'drop function ' || r.sig || ' cascade'; end loop;
end $$;

create function app.compute_monthly_bonus(p_employee uuid, p_month date)
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

grant execute on function app.compute_monthly_bonus(uuid, date) to authenticated;

notify pgrst, 'reload schema';
