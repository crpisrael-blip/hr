-- 0002 · לקוחות, אנשי קשר, הסכמים, משרות ופרסומים

create type app.company_status  as enum ('lead','active','on_hold','inactive');
create type app.job_stage       as enum ('draft','open','on_hold','filled','closed');
create type app.publication_status as enum ('draft','published','unpublished');
create type app.employment_scope as enum ('full_time','part_time','temporary','contract','student');
create type finance.commission_base as enum ('monthly','annual');

create table app.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  business_id        text,
  status             app.company_status not null default 'lead',
  owner_employee_id  uuid references app.employees(id) on delete set null,
  website            text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on app.companies (owner_employee_id);
create index on app.companies (status);

create table app.contacts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references app.companies(id) on delete cascade,
  full_name          text not null,
  title              text,
  email              text,
  phone              text,
  preferred_channel  app.channel,
  is_primary         boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on app.contacts (company_id);

-- הסכם מסחרי. שינוי יוצר גרסה חדשה; השמה מפנה לגרסה שהייתה בתוקף ביום הקבלה.
create table app.agreements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references app.companies(id) on delete cascade,
  version             integer not null,
  commission_pct      numeric(6,3) not null check (commission_pct > 0 and commission_pct <= 1000),
  commission_base     finance.commission_base not null,
  warranty_days       integer not null check (warranty_days >= 0),
  installments        integer not null default 1 check (installments between 1 and 36),
  payment_terms_days  integer not null default 0 check (payment_terms_days >= 0),
  valid_from          date not null,
  valid_to            date,
  notes               text,
  created_by          uuid references app.employees(id),
  created_at          timestamptz not null default now(),
  unique (company_id, version),
  constraint agreement_dates check (valid_to is null or valid_to >= valid_from)
);
create index on app.agreements (company_id, valid_from desc);

create table app.jobs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references app.companies(id) on delete restrict,
  title                 text not null,
  internal_description  text,
  must_have             text,
  nice_to_have          text,
  salary_min            numeric(12,2),
  salary_max            numeric(12,2),
  currency              char(3) not null default 'ILS',
  location              text,
  employment_scope      app.employment_scope,
  headcount             integer not null default 1 check (headcount >= 1),
  recruiter_id          uuid references app.employees(id) on delete set null,
  stage                 app.job_stage not null default 'draft',
  opened_at             date,
  closed_at             date,
  created_by            uuid references app.employees(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint job_salary_range check (salary_min is null or salary_max is null or salary_max >= salary_min)
);
create index on app.jobs (company_id);
create index on app.jobs (recruiter_id);
create index on app.jobs (stage);

-- פרסום: מה שנחשף באתר. slug הוא המזהה בכתובת, לא מזהה רץ.
create table app.job_publications (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references app.jobs(id) on delete cascade,
  slug                 text not null unique,
  public_title         text not null,
  public_body          text not null,
  expose_company_name  boolean not null default false,
  public_location      text,
  status               app.publication_status not null default 'draft',
  published_at         timestamptz,
  unpublished_at       timestamptz,
  created_by           uuid references app.employees(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index on app.job_publications (job_id);
create index on app.job_publications (status) where status = 'published';

create trigger touch before update on app.companies        for each row execute function app.touch_updated_at();
create trigger touch before update on app.contacts         for each row execute function app.touch_updated_at();
create trigger touch before update on app.jobs             for each row execute function app.touch_updated_at();
create trigger touch before update on app.job_publications for each row execute function app.touch_updated_at();

-- התצוגה היחידה שהאתר הציבורי נבנה ממנה. אין בה שום שדה פנימי.
create view app.published_jobs as
select p.slug,
       p.public_title            as title,
       p.public_body             as body,
       coalesce(p.public_location, j.location) as location,
       j.employment_scope,
       case when p.expose_company_name then c.name end as company_name,
       p.published_at
from app.job_publications p
join app.jobs      j on j.id = p.job_id
join app.companies c on c.id = j.company_id
where p.status = 'published'
  and j.stage in ('open','on_hold');
