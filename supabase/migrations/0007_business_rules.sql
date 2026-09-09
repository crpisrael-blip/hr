-- 0007 · שתי הנוסחאות שהאפיון מגדיר במפורש, כפונקציות במסד
-- כדי שיהיה מקור אמת אחד ושאפשר יהיה לבדוק אותן.

-- ---------- לוח תשלומים ----------
-- שארית העיגול נכנסת לתשלום האחרון, כך שהסכום הכולל שווה בדיוק לעמלה.
-- מועד פירעון = היום האחרון בחודש ההפקה + ימי תנאי התשלום.
create or replace function finance.build_schedule(
  p_total        numeric,
  p_installments integer,
  p_first_issue  date,
  p_terms_days   integer
) returns table (seq integer, amount numeric, planned_issue_date date, due_date date)
language plpgsql immutable as $$
declare
  v_base   numeric(14,2);
  v_issue  date;
  i        integer;
begin
  if p_installments < 1 then
    raise exception 'installments must be at least 1';
  end if;
  v_base := round(p_total / p_installments, 2);
  for i in 1..p_installments loop
    v_issue := (p_first_issue + make_interval(months => i - 1))::date;
    seq                := i;
    amount             := case when i < p_installments
                               then v_base
                               else p_total - v_base * (p_installments - 1) end;
    planned_issue_date := v_issue;
    due_date           := (date_trunc('month', v_issue) + interval '1 month - 1 day')::date
                          + p_terms_days;
    return next;
  end loop;
end $$;

-- ---------- בונוס במדרגות שוליות ----------
create type finance.bonus_input as (
  placement_id uuid,
  commission   numeric,
  start_date   date
);

-- כל מדרגה חלה רק על החלק שבתוכה.
-- placements_count: ההשמות מסודרות לפי תאריך תחילה, וכל אחת משויכת למדרגה לפי מיקומה.
-- commission_sum:   העמלות מצטברות, והשמה שחוצה גבול מפוצלת בין המדרגות באופן יחסי.
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
      amount := round(r.commission * pct / 100, 2);
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
        base := seg; amount := round(seg * p_pct1 / 100, 2); return next;
      end if;

      seg := greatest(0, top - greatest(cum, p_target_b));
      if seg > 0 then
        placement_id := r.placement_id; tier := 2; pct := p_pct2;
        base := seg; amount := round(seg * p_pct2 / 100, 2); return next;
      end if;

      cum := top;
    end if;
  end loop;
end $$;
