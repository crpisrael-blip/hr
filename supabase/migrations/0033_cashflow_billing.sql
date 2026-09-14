-- 0033 · תזרים, חיובים ותקבולים — השלמת מודל הכספים.
-- כללי העסק (אפיון): החיוב על השמה נבנה לפי לוח התשלומים של ההסכם (0005/0007/0009).
--
-- דרישת התזרים:
--   • מרגע ההשמה — עוד לפני אישורה — הכנסתה הצפויה מופיעה בתזרים כ"צפוי",
--     לפי העמלה הצפויה ולוח התשלומים של ההסכם.
--   • עם אישור ההשמה נוצרים חיובים אמיתיים (finance.invoices); התזרים עובר
--     להישען עליהם, כולל הסטטוס וסכום התקבול בפועל.
--   • כל תשלום מאושר כ"התקבל" כשמגיע מועדו (app.confirm_invoice_receipt).
--   • אם ההשמה נכשלה (לא התחיל / עזב באחריות / בוטלה) — היא יוצאת מהתזרים,
--     וההכנסה הצפויה יורדת ממנו.

-- ---------- תצוגת התזרים ----------
-- security_invoker: התצוגה נאכפת לפי RLS של המשתמש הקורא (מנהלת רואה הכול,
-- מגייס רק את השמותיו) ולא לפי בעל התצוגה — כדי שלא תדלוף גישה לכספים.
create or replace view finance.cashflow
  with (security_invoker = true) as
with active as (
  -- השמות חיות בלבד: השמה שנכשלה כבר אינה בתזרים.
  select p.id, p.company_id, p.recruiter_id, p.application_id, p.currency,
         p.expected_commission, p.expected_start_date, p.accepted_at, p.status,
         ag.installments as ag_installments, ag.payment_terms_days as ag_terms
    from finance.placements p
    join app.agreements ag on ag.id = p.agreement_id
   where p.status in ('pending_start','working_warranty','approved')
)
-- (1) חיובים אמיתיים — כשכבר קיים לוח תשלומים (אחרי אישור ההשמה).
select
  a.id                                     as placement_id,
  a.company_id,
  a.recruiter_id,
  a.application_id,
  a.currency,
  i.id                                     as invoice_id,
  i.seq,
  i.due_date,
  date_trunc('month', i.due_date)::date    as month,
  'invoiced'::text                         as kind,
  i.status::text                           as status,
  i.amount                                 as expected_amount,
  coalesce(rc.received, 0)                 as received_amount
from active a
join finance.payment_schedules s on s.placement_id = a.id
join finance.invoices i on i.schedule_id = s.id and i.status <> 'cancelled'
left join lateral (
  select sum(al.amount) as received
    from finance.receipt_allocations al
   where al.invoice_id = i.id
) rc on true

union all

-- (2) הכנסה צפויה — כל עוד אין לוח תשלומים (ממתין לתחילת עבודה / בתקופת אחריות).
--     נגזרת מהעמלה הצפויה ומלוח ההסכם, מעוגנת לתחילת העבודה הצפויה.
select
  a.id,
  a.company_id,
  a.recruiter_id,
  a.application_id,
  a.currency,
  null::uuid                               as invoice_id,
  b.seq,
  b.due_date,
  date_trunc('month', b.due_date)::date    as month,
  'projected'::text                        as kind,
  'projected'::text                        as status,
  b.amount                                 as expected_amount,
  0::numeric                               as received_amount
from active a
cross join lateral finance.build_schedule(
  a.expected_commission,
  a.ag_installments,
  date_trunc('month', coalesce(a.expected_start_date, a.accepted_at))::date,
  a.ag_terms
) b
where not exists (select 1 from finance.payment_schedules s where s.placement_id = a.id);

grant select on finance.cashflow to authenticated;

-- ---------- אישור תקבול על חיוב ----------
-- מאשר שהתשלום התקבל בפועל: רושם תקבול, משייך אותו לחיוב, ומעדכן את סטטוס
-- החיוב (שולם / שולם חלקית). ניתן לאשר תקבול חלקי; היתרה נשארת פתוחה.
create or replace function app.confirm_invoice_receipt(
  p_invoice  uuid,
  p_amount   numeric default null,   -- ברירת מחדל: מלוא היתרה לתשלום
  p_received date    default null,   -- ברירת מחדל: היום
  p_method   text    default null,
  p_ref      text    default null
) returns uuid
language plpgsql security definer set search_path = app, finance, public as $$
declare
  inv         finance.invoices%rowtype;
  v_company   uuid;
  v_allocated numeric;
  v_remaining numeric;
  v_amt       numeric;
  v_receipt   uuid;
begin
  if not app.is_manager() then raise exception 'רק מנהלת מאשרת תקבול'; end if;

  select * into inv from finance.invoices where id = p_invoice;
  if inv.id is null then raise exception 'חיוב לא נמצא'; end if;
  if inv.status = 'cancelled' then raise exception 'החיוב בוטל ואי אפשר לאשר עליו תקבול'; end if;

  select p.company_id into v_company
    from finance.payment_schedules s
    join finance.placements p on p.id = s.placement_id
   where s.id = inv.schedule_id;

  select coalesce(sum(amount), 0) into v_allocated
    from finance.receipt_allocations where invoice_id = p_invoice;
  v_remaining := inv.amount - v_allocated;
  if v_remaining <= 0 then raise exception 'החיוב כבר שולם במלואו'; end if;

  v_amt := coalesce(p_amount, v_remaining);
  if v_amt <= 0 then raise exception 'סכום התקבול חייב להיות חיובי'; end if;
  if v_amt > v_remaining then
    raise exception 'סכום התקבול (%) עולה על היתרה לתשלום (%)', v_amt, v_remaining;
  end if;

  insert into finance.receipts (company_id, amount, currency, received_at, method, external_ref, created_by)
  values (v_company, v_amt, inv.currency, coalesce(p_received, current_date), p_method, p_ref, app.current_employee())
  returning id into v_receipt;

  insert into finance.receipt_allocations (receipt_id, invoice_id, amount)
  values (v_receipt, p_invoice, v_amt);

  v_allocated := v_allocated + v_amt;
  update finance.invoices set
    status    = (case when v_allocated >= amount then 'paid' else 'partially_paid' end)::finance.invoice_status,
    issued_at = coalesce(issued_at, now()),
    updated_at = now()
  where id = p_invoice;

  return v_receipt;
end $$;

-- ---------- הפקת חיוב ----------
-- מסמן חיוב מתוכנן כ"הופק" (למשל כשמפיקים חשבונית ללקוח). אופציונלי לצד התקבול.
create or replace function app.issue_invoice(p_invoice uuid, p_external_ref text default null)
returns void language plpgsql security definer set search_path = app, finance, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת מפיקה חיוב'; end if;
  update finance.invoices set
    status       = case when status = 'planned' then 'issued'::finance.invoice_status else status end,
    issued_at    = coalesce(issued_at, now()),
    external_ref = coalesce(p_external_ref, external_ref),
    updated_at   = now()
  where id = p_invoice and status in ('planned','issued');
  if not found then raise exception 'אפשר להפיק רק חיוב מתוכנן'; end if;
end $$;

grant execute on function
  app.confirm_invoice_receipt(uuid, numeric, date, text, text),
  app.issue_invoice(uuid, text)
  to authenticated;
