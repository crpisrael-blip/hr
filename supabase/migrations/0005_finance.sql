-- 0005 · השמות, לוח תשלומים, חיובים, תקבולים, בונוסים והצעות קיזוז
-- כללי העסק שמאחורי הקובץ: אפיון, תרחיש 3.

create type finance.placement_status as enum (
  'pending_start','working_warranty','approved',
  'not_started','left_in_warranty','cancelled');
create type finance.invoice_status  as enum ('planned','issued','partially_paid','paid','cancelled','credited');
create type finance.bonus_metric    as enum ('placements_count','commission_sum');
create type finance.bonus_status    as enum ('draft','review','approved','paid');
create type finance.clawback_status as enum ('open','decided','closed');
create type finance.clawback_treatment as enum ('offset','spread','deferred','none');
create type finance.period_status   as enum ('open','calculating','review','approved','closed');

-- ---------- השמה ----------
-- expected_commission ננעל ביצירה. שינוי שכר מאוחר אינו משנה אותו אלא בפעולה מפורשת.
create table finance.placements (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null unique references app.applications(id) on delete restrict,
  company_id           uuid not null references app.companies(id) on delete restrict,
  recruiter_id         uuid not null references app.employees(id) on delete restrict,
  agreement_id         uuid not null references app.agreements(id) on delete restrict,
  accepted_at          date not null,
  expected_start_date  date,
  verified_start_date  date,
  agreed_salary        numeric(12,2) not null check (agreed_salary > 0),
  commission_base      finance.commission_base not null,
  commission_pct       numeric(6,3) not null,
  expected_commission  numeric(14,2) not null check (expected_commission >= 0),
  currency             char(3) not null default 'ILS',
  warranty_days        integer not null,
  warranty_ends_on     date,
  status               finance.placement_status not null default 'pending_start',
  approved_by          uuid references app.employees(id),
  approved_at          timestamptz,
  ended_reason         text,
  created_by           uuid references app.employees(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on finance.placements (recruiter_id, verified_start_date);
create index on finance.placements (status);
create index on finance.placements (warranty_ends_on) where status = 'working_warranty';

-- warranty_ends_on נגזר מתאריך התחילה המאומת ומאורך האחריות בהסכם.
create or replace function finance.set_warranty_end() returns trigger
language plpgsql as $$
begin
  if new.verified_start_date is not null then
    new.warranty_ends_on := new.verified_start_date + new.warranty_days;
  else
    new.warranty_ends_on := null;
  end if;
  return new;
end $$;
create trigger set_warranty before insert or update of verified_start_date, warranty_days
  on finance.placements for each row execute function finance.set_warranty_end();

-- ---------- לוח תשלומים ----------
-- נוצר עם אישור ההשמה. אחד להשמה, כדי שניסיון חוזר לא ייצר כפילות.
create table finance.payment_schedules (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null unique references finance.placements(id) on delete cascade,
  total_amount numeric(14,2) not null check (total_amount >= 0),
  installments integer not null check (installments >= 1),
  created_at   timestamptz not null default now()
);

create table finance.invoices (
  id                  uuid primary key default gen_random_uuid(),
  schedule_id         uuid not null references finance.payment_schedules(id) on delete cascade,
  seq                 integer not null,
  amount              numeric(14,2) not null check (amount >= 0),
  currency            char(3) not null default 'ILS',
  planned_issue_date  date not null,
  due_date            date not null,
  external_ref        text,
  issued_at           timestamptz,
  status              finance.invoice_status not null default 'planned',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (schedule_id, seq)
);
create index on finance.invoices (status, planned_issue_date);

create table finance.receipts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references app.companies(id) on delete set null,
  amount      numeric(14,2) not null check (amount > 0),
  currency    char(3) not null default 'ILS',
  received_at date not null,
  method      text,
  external_ref text,
  created_by  uuid references app.employees(id),
  created_at  timestamptz not null default now()
);

-- תקבול יכול להתפרס על כמה חיובים וחיוב יכול לקבל כמה תקבולים.
create table finance.receipt_allocations (
  receipt_id uuid not null references finance.receipts(id) on delete cascade,
  invoice_id uuid not null references finance.invoices(id) on delete cascade,
  amount     numeric(14,2) not null check (amount > 0),
  primary key (receipt_id, invoice_id)
);

-- ---------- תוכנית תגמול ----------
-- מדרגות שוליות: כל מדרגה חלה רק על החלק שבתוכה.
create table finance.bonus_plans (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id) on delete cascade,
  version     integer not null,
  metric      finance.bonus_metric not null,
  target_a    numeric(14,2) not null check (target_a >= 0),
  target_b    numeric(14,2) not null,
  pct_tier_1  numeric(6,3) not null check (pct_tier_1 >= 0),
  pct_tier_2  numeric(6,3) not null check (pct_tier_2 >= 0),
  valid_from  date not null,
  valid_to    date,
  created_by  uuid references app.employees(id),
  created_at  timestamptz not null default now(),
  unique (employee_id, version),
  constraint targets_ordered check (target_b >= target_a)
);
create index on finance.bonus_plans (employee_id, valid_from desc);

-- ---------- חישוב חודשי ----------
-- אחד לכל מגייס לכל חודש. ניסיון חוזר מזהה את הקיים ולא יוצר חדש.
create table finance.bonus_calculations (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references app.employees(id) on delete restrict,
  period_month date not null,
  plan_id      uuid references finance.bonus_plans(id) on delete set null,
  plan_version integer,
  metric_value numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  status       finance.bonus_status not null default 'draft',
  approved_by  uuid references app.employees(id),
  approved_at  timestamptz,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (employee_id, period_month)
);
create index on finance.bonus_calculations (period_month, status);

create table finance.bonus_calculation_lines (
  id              uuid primary key default gen_random_uuid(),
  calculation_id  uuid not null references finance.bonus_calculations(id) on delete cascade,
  placement_id    uuid references finance.placements(id) on delete restrict,
  clawback_id     uuid,               -- שורה שלילית מקיזוז של חודש קודם
  expected_commission numeric(14,2),
  tier            smallint check (tier in (0,1,2)),
  pct             numeric(6,3),
  amount          numeric(14,2) not null,
  note            text,
  constraint line_source check (num_nonnulls(placement_id, clawback_id) = 1)
);
create index on finance.bonus_calculation_lines (calculation_id);
-- השמה נספרת פעם אחת בכל מדרגה. במדד "סכום עמלות" השמה שחוצה גבול
-- מפוצלת לשתי שורות, ולכן המפתח כולל את המדרגה.
create unique index bonus_line_placement_uniq
  on finance.bonus_calculation_lines (calculation_id, placement_id, tier)
  where placement_id is not null;

-- ---------- הצעת קיזוז ----------
-- נפתחת בכישלון השמה. אינה מקזזת דבר עד להחלטת המנהלת (אפיון, גרסה 0.4).
create table finance.clawback_proposals (
  id                 uuid primary key default gen_random_uuid(),
  placement_id       uuid not null references finance.placements(id) on delete cascade,
  calculation_id     uuid references finance.bonus_calculations(id) on delete set null,
  employee_id        uuid not null references app.employees(id) on delete restrict,
  proposed_amount    numeric(14,2) not null check (proposed_amount >= 0),
  decided_amount     numeric(14,2) check (decided_amount >= 0),
  treatment          finance.clawback_treatment,
  spread_months      integer check (spread_months is null or spread_months >= 1),
  defer_until        date,
  reason             text,
  status             finance.clawback_status not null default 'open',
  decided_by         uuid references app.employees(id),
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  unique (placement_id)
);
create index on finance.clawback_proposals (status) where status = 'open';

alter table finance.bonus_calculation_lines
  add constraint bonus_line_clawback_fk
  foreign key (clawback_id) references finance.clawback_proposals(id) on delete set null;

-- ---------- תקופת התחשבנות ----------
create table finance.periods (
  period_month date primary key,
  status       finance.period_status not null default 'open',
  approved_by  uuid references app.employees(id),
  approved_at  timestamptz,
  closed_at    timestamptz
);

create trigger touch before update on finance.placements          for each row execute function app.touch_updated_at();
create trigger touch before update on finance.invoices            for each row execute function app.touch_updated_at();
create trigger touch before update on finance.bonus_calculations  for each row execute function app.touch_updated_at();
