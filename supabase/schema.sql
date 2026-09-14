-- HR schema (0001..0033 merged for Supabase SQL Editor)

-- === 0001_foundation.sql ===
-- 0001 · יסודות: סכמות, טיפוסים, משתמשים, הרשאות, הגדרות ויומן ביקורת
-- ההרשאות הן נתונים ולא קוד: הערכים כאן נערכים מתוך המערכת (אפיון, סעיף הגדרות ארגון).

create schema if not exists app;
create schema if not exists finance;
create schema if not exists audit;

-- ב-Supabase הסכמה auth וטבלת auth.users כבר קיימות ושייכות לרול אחר,
-- שאין ל-SQL Editor הרשאה ליצור בו. לכן יוצרים stub רק כשהטבלה חסרה
-- (כלומר על Postgres נקי לבדיקות), ומדלגים לגמרי על Supabase.
do $$
begin
  if to_regclass('auth.users') is null then
    create schema if not exists auth;
    create table auth.users (id uuid primary key);
    -- stub ל-auth.uid() כדי שמדיניות RLS תרוץ גם על Postgres נקי לבדיקות.
    execute $fn$ create function auth.uid() returns uuid language sql stable as 'select null::uuid' $fn$;
  end if;
end $$;

create extension if not exists pgcrypto;

-- ---------- טיפוסים ----------
create type app.user_role as enum ('interested','candidate','recruiter','manager','superadmin');
create type app.perm_module as enum (
  'candidates','jobs','companies','applications','placements',
  'invoicing','settlements','tasks','candidate_messages',
  'website','reports','imports','users_permissions','org_settings','system_settings');
create type app.perm_action as enum ('view','create','edit','delete','export','approve');
-- none < own < team < all. הסדר משמעותי: היקף רחב יותר גובר בהענקה.
create type app.perm_scope as enum ('none','own','team','all');
create type app.perm_kind as enum ('grant','deny');
create type app.employment_status as enum ('active','suspended','ended');
create type app.channel as enum ('in_app','email','whatsapp','sms');

-- ---------- עדכון חותמת זמן ----------
create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- הגדרות ארגון ----------
-- כל שינוי כאן נרשם ב-audit.events על ידי שכבת ה-API.
create table app.settings (
  key          text primary key,
  value        jsonb        not null,
  description  text,
  updated_by   uuid         references auth.users(id),
  updated_at   timestamptz  not null default now()
);

-- ---------- צוותים ועובדים ----------
create table app.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table app.employees (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid unique references auth.users(id) on delete set null,
  full_name          text not null,
  email              text not null unique,
  phone              text,
  role               app.user_role not null default 'recruiter',
  team_id            uuid references app.teams(id) on delete set null,
  manager_id         uuid references app.employees(id) on delete set null,
  employment_status  app.employment_status not null default 'active',
  two_factor_enabled boolean not null default false,
  invited_at         timestamptz,
  last_login_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint employees_role_is_staff check (role in ('recruiter','manager','superadmin'))
);
create index on app.employees (team_id);
create index on app.employees (employment_status);

alter table app.teams add column lead_employee_id uuid references app.employees(id) on delete set null;

create trigger touch before update on app.teams   for each row execute function app.touch_updated_at();
create trigger touch before update on app.employees for each row execute function app.touch_updated_at();

-- ---------- הרשאות ----------
-- שכבה 1: ברירת מחדל לסוג המשתמש. נערכת מתוך מסך ההגדרות.
create table app.permission_defaults (
  role    app.user_role  not null,
  module  app.perm_module not null,
  action  app.perm_action not null,
  scope   app.perm_scope  not null default 'none',
  primary key (role, module, action)
);

-- שכבה 2: פרופילים (ראש צוות, כספים, עורך תוכן, קורא דוחות, ומה שהמנהלת תיצור).
create table app.permission_profiles (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  is_builtin  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table app.permission_profile_rules (
  profile_id uuid not null references app.permission_profiles(id) on delete cascade,
  module     app.perm_module not null,
  action     app.perm_action not null,
  scope      app.perm_scope  not null,
  primary key (profile_id, module, action)
);

create table app.employee_permission_profiles (
  employee_id uuid not null references app.employees(id) on delete cascade,
  profile_id  uuid not null references app.permission_profiles(id) on delete cascade,
  assigned_by uuid references app.employees(id),
  assigned_at timestamptz not null default now(),
  primary key (employee_id, profile_id)
);

-- שכבה 3: עקיפה למשתמש בודד. deny גובר על כל הענקה.
create table app.permission_overrides (
  id          uuid primary key default gen_random_uuid(),
  employee_id uuid not null references app.employees(id) on delete cascade,
  module      app.perm_module not null,
  action      app.perm_action not null,
  scope       app.perm_scope  not null,
  kind        app.perm_kind   not null,
  valid_until timestamptz,
  granted_by  uuid not null references app.employees(id),
  reason      text not null,
  created_at  timestamptz not null default now(),
  unique (employee_id, module, action, kind)
);
create index on app.permission_overrides (employee_id);
create index on app.permission_overrides (valid_until) where valid_until is not null;

-- ---------- יומן ביקורת ----------
-- הוספה בלבד. הרשאות UPDATE ו-DELETE נשללות בסוף הקובץ.
create table audit.events (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid references auth.users(id),
  actor_label  text,
  action       text not null,
  entity_type  text,
  entity_id    text,
  changes      jsonb,
  ip           inet,
  user_agent   text
);
create index on audit.events (occurred_at desc);
create index on audit.events (entity_type, entity_id);
create index on audit.events (actor_id);

revoke update, delete, truncate on audit.events from public;

-- === 0002_crm.sql ===
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

-- === 0003_candidates.sql ===
-- 0003 · מועמדים, מסמכים, מועמדויות, ראיונות והאזור האישי

create type app.application_stage as enum (
  'new','screening','initial_call','submitted_to_client','interview','offer','hired',
  'rejected','withdrawn','job_cancelled');
create type app.document_kind   as enum ('cv','cover_letter','certificate','summary','submission_pack','other');
create type app.file_check      as enum ('pending','passed','failed','quarantined');
create type app.consent_kind    as enum ('data_use','marketing','whatsapp');
create type app.ai_status       as enum ('queued','processing','done','needs_review','failed');
create type app.conversation_status as enum ('open','closed');
create type app.sender_type     as enum ('candidate','recruiter');
create type app.deletion_status as enum ('open','verified','done','rejected');

-- ---------- מתעניין ----------
-- נרשם באתר בלי להגיש. הגשה ראשונה יוצרת רשומת מועמד ומקשרת את אותו חשבון.
create table app.interested (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique not null references auth.users(id) on delete cascade,
  full_name    text not null,
  phone        text not null,
  email        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- מועמד ----------
-- phone_normalized הוא מפתח הכפילות היחיד (אפיון, החלטה בגרסה 0.2).
create table app.candidates (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid unique references auth.users(id) on delete set null,
  full_name          text not null,
  phone_normalized   text,
  phone_raw          text,
  email              text,
  years_experience   numeric(4,1),
  skills             text[],
  preferences        jsonb not null default '{}'::jsonb,
  desired_salary     numeric(12,2),
  availability       text,
  source             text,
  owner_employee_id  uuid references app.employees(id) on delete set null,
  possible_duplicate_of uuid references app.candidates(id) on delete set null,
  anonymized_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
-- כפילות נאכפת רק על רשומות פעילות ובעלות טלפון תקין.
create unique index candidates_phone_unique
  on app.candidates (phone_normalized)
  where phone_normalized is not null and anonymized_at is null;
create index on app.candidates (owner_employee_id);
create index on app.candidates (email);

create table app.candidate_consents (
  candidate_id uuid not null references app.candidates(id) on delete cascade,
  kind         app.consent_kind not null,
  granted      boolean not null,
  granted_at   timestamptz not null default now(),
  source       text,
  primary key (candidate_id, kind)
);

-- ---------- מסמכים ----------
-- הקובץ עצמו יושב באחסון פרטי. כאן רק המצביע והמטא.
create table app.documents (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid references app.candidates(id) on delete cascade,
  kind          app.document_kind not null,
  version       integer not null default 1,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text not null,
  size_bytes    bigint not null check (size_bytes > 0),
  file_check    app.file_check not null default 'pending',
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index on app.documents (candidate_id, kind, version desc);

-- תוצאות ניתוח AI. הן הצעות עד לאישור אדם; לא דורסות ערך שאושר ידנית.
create table app.document_analyses (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references app.documents(id) on delete cascade,
  status         app.ai_status not null default 'queued',
  engine_version text,
  extracted      jsonb,
  summary        text,
  missing_fields text[],
  cost_usd       numeric(10,5),
  error          text,
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);
create index on app.document_analyses (status) where status in ('queued','processing');

-- ---------- מועמדות ----------
create table app.applications (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references app.candidates(id) on delete cascade,
  job_id            uuid not null references app.jobs(id) on delete restrict,
  recruiter_id      uuid references app.employees(id) on delete set null,
  source            text,
  stage             app.application_stage not null default 'new',
  stage_changed_at  timestamptz not null default now(),
  on_hold           boolean not null default false,
  close_reason      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (candidate_id, job_id)
);
create index on app.applications (job_id, stage);
create index on app.applications (recruiter_id);
create index on app.applications (candidate_id);

create table app.application_stage_history (
  id             bigserial primary key,
  application_id uuid not null references app.applications(id) on delete cascade,
  from_stage     app.application_stage,
  to_stage       app.application_stage not null,
  reason         text,
  changed_by     uuid references app.employees(id),
  changed_at     timestamptz not null default now()
);
create index on app.application_stage_history (application_id, changed_at desc);

-- הגשה ללקוח: שומרת נמען וגרסת מסמך. "נשלח ידנית" נבדל מ"נשלח" מהמערכת.
create table app.client_submissions (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null references app.applications(id) on delete cascade,
  contact_id          uuid references app.contacts(id) on delete set null,
  document_id         uuid references app.documents(id) on delete set null,
  summary_sent        text,
  channel             app.channel not null,
  sent_manually       boolean not null default false,
  sent_at             timestamptz not null,
  provider_message_id text,
  feedback            text,
  feedback_at         timestamptz,
  created_by          uuid references app.employees(id),
  created_at          timestamptz not null default now()
);
create index on app.client_submissions (application_id, sent_at desc);

create table app.interviews (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references app.applications(id) on delete cascade,
  scheduled_at   timestamptz not null,
  timezone       text not null default 'Asia/Jerusalem',
  location       text,
  participants   text[],
  expose_interviewer boolean not null default false,
  status         text not null default 'scheduled',
  feedback       text,
  created_by     uuid references app.employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on app.interviews (application_id, scheduled_at desc);

-- ---------- האזור האישי ----------
-- מה המועמד רואה. נערך מתוך המערכת (אפיון, החלטה בגרסה 0.7).
create table app.stage_exposure (
  stage            app.application_stage primary key,
  exposed          boolean not null default false,
  candidate_label  text,
  explanation      text,
  updated_by       uuid references app.employees(id),
  updated_at       timestamptz not null default now()
);

create table app.conversations (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references app.candidates(id) on delete cascade,
  application_id  uuid references app.applications(id) on delete cascade,
  recruiter_id    uuid references app.employees(id) on delete set null,
  status          app.conversation_status not null default 'open',
  last_message_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (application_id)
);
create index on app.conversations (candidate_id);

create table app.conversation_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references app.conversations(id) on delete cascade,
  sender_type     app.sender_type not null,
  sender_user_id  uuid references auth.users(id),
  body            text not null,
  document_id     uuid references app.documents(id) on delete set null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index on app.conversation_messages (conversation_id, created_at);

create table app.saved_jobs (
  user_id        uuid not null references auth.users(id) on delete cascade,
  publication_id uuid not null references app.job_publications(id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (user_id, publication_id)
);

create table app.job_alerts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  criteria   jsonb not null default '{}'::jsonb,
  frequency  text not null default 'weekly',
  active     boolean not null default true,
  last_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index on app.job_alerts (user_id);

-- ---------- פרטיות ----------
create table app.deletion_requests (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references app.candidates(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  channel       text,
  verified_by   uuid references app.employees(id),
  status        app.deletion_status not null default 'open',
  completed_at  timestamptz,
  what_removed  text,
  what_kept     text
);
create index on app.deletion_requests (status) where status <> 'done';

-- ---------- הודעות יוצאות ----------
create table app.outbound_messages (
  id              uuid primary key default gen_random_uuid(),
  channel         app.channel not null,
  recipient       text not null,
  template        text not null,
  entity_type     text,
  entity_id       text,
  body_preview    text,
  provider_id     text,
  delivery_status text not null default 'queued',
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index on app.outbound_messages (delivery_status) where delivery_status <> 'delivered';
create index on app.outbound_messages (entity_type, entity_id);

create trigger touch before update on app.interested  for each row execute function app.touch_updated_at();
create trigger touch before update on app.candidates  for each row execute function app.touch_updated_at();
create trigger touch before update on app.applications for each row execute function app.touch_updated_at();
create trigger touch before update on app.interviews  for each row execute function app.touch_updated_at();

-- === 0004_tasks.sql ===
-- 0004 · מנגנון משימות רוחבי: תבניות, תהליכים, אוטומציות, חזרות ותזכורות

create type app.task_status     as enum ('open','in_progress','done','cancelled');
create type app.task_priority   as enum ('low','normal','high','urgent');
create type app.task_completion as enum ('all_assignees','any_assignee');
create type app.task_privacy    as enum ('normal','private');
create type app.task_source     as enum ('manual','template','process','automation','recurring');
create type app.assignee_status as enum ('pending','in_progress','done','removed');
create type app.linked_entity   as enum ('candidate','company','job','application','placement','contact');
-- קטלוג האירועים סגור: אפשר להפעיל, לכבות ולשנות תנאי, לא להוסיף אירוע חדש בלי פיתוח.
create type app.automation_event as enum (
  'application_submitted','application_stage_changed','client_submission_no_feedback',
  'interview_scheduled','placement_created','start_date_unverified',
  'warranty_ending_soon','warranty_ended','job_inactive',
  'company_created','invoice_due_for_issue','clawback_opened','deletion_requested',
  'candidate_message_unanswered');

create table app.task_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null unique,
  title              text not null,
  description        text,
  priority           app.task_priority not null default 'normal',
  due_offset_days    integer,
  due_time           time,
  default_assignee_role text,          -- 'owner_recruiter' | 'team_lead' | 'finance' | 'manager'
  default_assignee_id uuid references app.employees(id) on delete set null,
  completion_rule    app.task_completion not null default 'all_assignees',
  reminders          jsonb not null default '[]'::jsonb,
  required_entity    app.linked_entity,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table app.task_processes (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  description     text,
  required_entity app.linked_entity,
  created_at      timestamptz not null default now()
);

create table app.task_process_items (
  process_id      uuid not null references app.task_processes(id) on delete cascade,
  position        integer not null,
  template_id     uuid not null references app.task_templates(id) on delete restrict,
  due_offset_days integer,
  primary key (process_id, position)
);

create table app.task_recurrences (
  id           uuid primary key default gen_random_uuid(),
  rule         jsonb not null,           -- {freq, days, day_of_month, interval}
  due_time     time,
  ends_after   integer,
  ends_on      date,
  active       boolean not null default true,
  template_id  uuid references app.task_templates(id) on delete set null,
  created_by   uuid references app.employees(id),
  created_at   timestamptz not null default now(),
  last_spawned_at timestamptz
);

create table app.automation_rules (
  id           uuid primary key default gen_random_uuid(),
  event        app.automation_event not null,
  name         text not null,
  conditions   jsonb not null default '{}'::jsonb,
  template_id  uuid references app.task_templates(id) on delete restrict,
  process_id   uuid references app.task_processes(id) on delete restrict,
  active       boolean not null default true,
  is_mandatory boolean not null default false,  -- warranty_ended אינו ניתן לכיבוי
  created_by   uuid references app.employees(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint automation_target check (num_nonnulls(template_id, process_id) = 1)
);
create index on app.automation_rules (event) where active;

create table app.tasks (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  description     text,
  priority        app.task_priority not null default 'normal',
  status          app.task_status   not null default 'open',
  due_at          timestamptz,
  completion_rule app.task_completion not null default 'all_assignees',
  privacy         app.task_privacy  not null default 'normal',
  source          app.task_source   not null default 'manual',
  created_by      uuid references app.employees(id) on delete set null,
  parent_task_id  uuid references app.tasks(id) on delete set null,
  recurrence_id   uuid references app.task_recurrences(id) on delete set null,
  automation_rule_id uuid references app.automation_rules(id) on delete set null,
  entity_closed_note text,
  cancel_reason   text,
  completed_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on app.tasks (status, due_at) where status in ('open','in_progress');
create index on app.tasks (created_by);
-- מונע יצירה חוזרת של אותה משימת אוטומציה כל עוד הקודמת פתוחה.
create unique index tasks_open_automation_uniq
  on app.tasks (automation_rule_id, parent_task_id)
  where automation_rule_id is not null and status in ('open','in_progress');

create table app.task_assignees (
  task_id         uuid not null references app.tasks(id) on delete cascade,
  employee_id     uuid not null references app.employees(id) on delete cascade,
  personal_status app.assignee_status not null default 'pending',
  done_at         timestamptz,
  note            text,
  added_by        uuid references app.employees(id),
  added_at        timestamptz not null default now(),
  primary key (task_id, employee_id)
);
create index on app.task_assignees (employee_id, personal_status);

create table app.task_links (
  task_id     uuid not null references app.tasks(id) on delete cascade,
  entity_type app.linked_entity not null,
  entity_id   uuid not null,
  primary key (task_id, entity_type, entity_id)
);
create index on app.task_links (entity_type, entity_id);

create table app.task_reminders (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references app.tasks(id) on delete cascade,
  channel           app.channel not null default 'in_app',
  offset_minutes    integer,        -- לפני היעד. יחסי: זז עם שינוי היעד
  absolute_at       timestamptz,
  sent_at           timestamptz,
  cancelled_at      timestamptz,
  constraint reminder_timing check (num_nonnulls(offset_minutes, absolute_at) = 1)
);
create index on app.task_reminders (task_id);

-- פעילות: תיעוד מה שקרה. נבדלת ממשימה, שהיא מה שצריך לקרות.
create table app.activities (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,           -- call | meeting | note | message
  actor_id    uuid references app.employees(id) on delete set null,
  entity_type app.linked_entity not null,
  entity_id   uuid not null,
  body        text,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index on app.activities (entity_type, entity_id, occurred_at desc);

create trigger touch before update on app.task_templates  for each row execute function app.touch_updated_at();
create trigger touch before update on app.automation_rules for each row execute function app.touch_updated_at();
create trigger touch before update on app.tasks           for each row execute function app.touch_updated_at();

-- === 0005_finance.sql ===
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

-- === 0006_seed_settings.sql ===
-- 0006 · ערכי התחלה. הכול ניתן לעריכה מתוך המערכת ואינו נעול בקוד.

-- ---------- הגדרות ארגון ----------
insert into app.settings (key, value, description) values
  ('candidates.pool_scope',        '"all"',        'היקף המגייס במודול מועמדים: all = מאגר משותף'),
  ('security.session_timeout_min', '480',          'פקיעת session לצוות בדקות'),
  ('security.require_2fa_recruiter','false',       'חיוב אימות דו־שלבי גם למגייסים'),
  ('files.allowed_mime',           '["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document"]', 'סוגי קובץ מותרים'),
  ('files.max_size_mb',            '10',           'גודל קובץ מרבי'),
  ('candidate_area.chat_enabled',  'true',         'שיחה עם המגייס פעילה באזור האישי'),
  ('candidate_area.editable_fields','["full_name","email","availability","desired_salary","preferences"]', 'שדות שהמועמד עורך בעצמו'),
  ('tasks.default_completion',     '"all_assignees"','כלל השלמה כברירת מחדל'),
  ('tasks.daily_digest_hour',      '8',            'שעת הסיכום היומי'),
  ('finance.rounding',             '"agora"',      'עיגול לאגורה בסוף החישוב'),
  ('ai.enabled',                   'false',        'ניתוח קורות חיים מושבת עד בחירת ספק'),
  ('ai.monthly_quota',             '0',            'מכסת ניתוחים חודשית');

-- ---------- הרשאות: ברירת מחדל לכל סוג משתמש ----------
-- הבסיס הוא none לכל שילוב, ומעליו הענקות מפורשות.
insert into app.permission_defaults (role, module, action, scope)
select r, m, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_module))  m
cross join unnest(enum_range(null::app.perm_action))  a;

-- מנהלת החברה: הכול בתוך הארגון. הגדרות מערכת לצפייה בלבד.
update app.permission_defaults set scope = 'all'
 where role = 'manager' and module <> 'system_settings';
update app.permission_defaults set scope = 'all'
 where role = 'manager' and module = 'system_settings' and action = 'view';

-- מנהל על: מעל הארגון. גישה תפעולית לצורך תמיכה בלבד, מתועדת.
update app.permission_defaults set scope = 'all'
 where role = 'superadmin'
   and module in ('system_settings','users_permissions','website','imports');
update app.permission_defaults set scope = 'all'
 where role = 'superadmin' and action = 'view'
   and module in ('candidates','jobs','companies','applications','placements','org_settings','reports');

-- מגייס: עבודה על מה שהותר לו, בלי כספים ובלי הגדרות.
update app.permission_defaults set scope = 'all'
 where role = 'recruiter'
   and module in ('candidates','jobs','companies','applications')
   and action in ('view','create');
update app.permission_defaults set scope = 'own'
 where role = 'recruiter'
   and module in ('candidates','jobs','companies','applications')
   and action = 'edit';
update app.permission_defaults set scope = 'own'
 where role = 'recruiter'
   and module in ('placements','candidate_messages','reports')
   and action in ('view','create','edit');
update app.permission_defaults set scope = 'own'
 where role = 'recruiter' and module = 'settlements' and action = 'view';
update app.permission_defaults set scope = 'all'
 where role = 'recruiter' and module = 'tasks' and action in ('view','create','edit');

-- ---------- פרופילי הרשאות מובנים ----------
insert into app.permission_profiles (name, description, is_builtin) values
  ('ראש צוות',  'היקף הצוות בכל מודולי העבודה ואישור מעברי שלב אחורה', true),
  ('כספים',     'חיובים, תקבולים והתחשבנות. ללא אישור בונוס וקיזוז',    true),
  ('עורך תוכן', 'ניהול אתר בלבד',                                        true),
  ('קורא דוחות','דוחות בהיקף מלא',                                       true);

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, m, a, 'team'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['candidates','jobs','companies','applications','placements','tasks']::app.perm_module[]) m
cross join unnest(array['view','edit','approve']::app.perm_action[]) a
where p.name = 'ראש צוות';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, m, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['invoicing','settlements']::app.perm_module[]) m
cross join unnest(array['view','create','edit']::app.perm_action[]) a
where p.name = 'כספים';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, 'website'::app.perm_module, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['view','create','edit','delete']::app.perm_action[]) a
where p.name = 'עורך תוכן';

insert into app.permission_profile_rules (profile_id, module, action, scope)
select p.id, 'reports'::app.perm_module, a, 'all'::app.perm_scope
from app.permission_profiles p
cross join unnest(array['view','export']::app.perm_action[]) a
where p.name = 'קורא דוחות';

-- ---------- חשיפת שלבים למועמד ----------
insert into app.stage_exposure (stage, exposed, candidate_label, explanation) values
  ('new',                 false, null,                      null),
  ('screening',           false, null,                      null),
  ('initial_call',        false, null,                      null),
  ('submitted_to_client', true,  'בבדיקה אצל המעסיק',       'קורות החיים שלך הועברו למעסיק וממתינים לתגובתו'),
  ('interview',           true,  'ראיון',                    'נקבע ראיון. הפרטים מופיעים למטה'),
  ('offer',               true,  'הצעה',                     'המעסיק הביע עניין ואנחנו בשלב ההצעה'),
  ('hired',               true,  'התקבלת',                   'ברכות, התהליך הושלם בהצלחה'),
  ('rejected',            true,  'התהליך הסתיים',            null),
  ('withdrawn',           true,  'התהליך הסתיים',            null),
  ('job_cancelled',       true,  'התהליך הסתיים',            null);

-- ---------- תבניות משימה וכללי אוטומציה ----------
insert into app.task_templates (name, title, description, priority, due_offset_days, default_assignee_role, required_entity) values
  ('טיפול בהגשה חדשה',   'לטפל בהגשה חדשה',            'לבדוק קורות חיים, ליצור קשר ולהחליט על המשך', 'normal', 1, 'owner_recruiter', 'application'),
  ('מעקב אחרי ראיון',    'מעקב אחרי ראיון',            'לבדוק עם המועמד ועם הלקוח איך עבר הראיון',    'normal', 1, 'owner_recruiter', 'application'),
  ('בדיקת משוב מהלקוח',  'לבדוק משוב מהלקוח',          'עברו חמישה ימים מההגשה ללא תגובה',            'normal', 0, 'owner_recruiter', 'application'),
  ('אימות תחילת עבודה',  'לאמת שהמועמד התחיל לעבוד',   null,                                          'high',   0, 'owner_recruiter', 'placement'),
  ('בדיקה לפני סיום אחריות','לבדוק שהמועמד עדיין מועסק','תקופת האחריות מסתיימת בעוד שבוע',            'high',   0, 'owner_recruiter', 'placement'),
  ('אימות סיום אחריות',  'לאמת שהמועמד עדיין מועסק',   'אישור זה פותח את הזכאות לחיוב',               'urgent', 3, 'owner_recruiter', 'placement'),
  ('מענה למועמד',        'לענות למועמד',                'הודעה מהמועמד ממתינה למענה',                  'high',   1, 'owner_recruiter', 'application'),
  ('החלטה בהצעת קיזוז',  'להחליט בהצעת קיזוז',          null,                                          'normal', 7, 'manager',         'placement'),
  ('הפקת חיוב',          'להפיק חיוב',                  'החיוב הגיע למועד ההפקה המתוכנן',              'normal', 0, 'finance',         'placement'),
  ('טיפול בבקשת מחיקה',  'לטפל בבקשת מחיקה',            null,                                          'high',   3, 'manager',         'candidate');

insert into app.automation_rules (event, name, conditions, template_id, active, is_mandatory)
select e.event, e.name, e.conditions, t.id, true, e.mandatory
from (values
  ('application_submitted'::app.automation_event,        'הגשה חדשה יוצרת משימת טיפול',      '{}'::jsonb,                        'טיפול בהגשה חדשה',      false),
  ('application_stage_changed',                          'מעבר לראיון יוצר משימת מעקב',      '{"to_stage":"interview"}'::jsonb,  'מעקב אחרי ראיון',       false),
  ('client_submission_no_feedback',                      'הגשה ללא משוב חמישה ימים',          '{"days":5}'::jsonb,                'בדיקת משוב מהלקוח',     false),
  ('start_date_unverified',                              'תאריך תחילה עבר ללא אימות',         '{}'::jsonb,                        'אימות תחילת עבודה',     false),
  ('warranty_ending_soon',                               'שבוע לפני סיום אחריות',             '{"days":7}'::jsonb,                'בדיקה לפני סיום אחריות',false),
  ('warranty_ended',                                     'סיום אחריות מחייב אימות',           '{}'::jsonb,                        'אימות סיום אחריות',     true),
  ('candidate_message_unanswered',                       'הודעת מועמד ללא מענה יומיים',       '{"days":2}'::jsonb,                'מענה למועמד',           false),
  ('clawback_opened',                                    'הצעת קיזוז ממתינה להחלטה',          '{}'::jsonb,                        'החלטה בהצעת קיזוז',     false),
  ('invoice_due_for_issue',                              'חיוב הגיע למועד הפקה',              '{}'::jsonb,                        'הפקת חיוב',             false),
  ('deletion_requested',                                 'בקשת מחיקה נפתחה',                  '{}'::jsonb,                        'טיפול בבקשת מחיקה',     false)
) as e(event, name, conditions, template_name, mandatory)
join app.task_templates t on t.name = e.template_name;

-- === 0007_business_rules.sql ===
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

-- === 0008_rls_access.sql ===
-- 0008 · גישת אפליקציית הצוות: חשיפת סכמת app ל-PostgREST ומדיניות RLS.
-- אכיפת MVP: רק עובד צוות פעיל ומחובר ניגש. חלוקת ההיקפים המדויקת (שלי/צוות/הכל)
-- תיאכף בשכבת ה-API בהמשך; כאן RLS מבטיח שרק צוות מזוהה נכנס בכלל.

-- ---------- מיהו המשתמש הנוכחי ----------
create or replace function app.current_employee()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select e.id from app.employees e
  where e.user_id = auth.uid() and e.employment_status = 'active'
  limit 1
$$;

create or replace function app.is_staff()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select exists (
    select 1 from app.employees e
    where e.user_id = auth.uid() and e.employment_status = 'active'
  )
$$;

create or replace function app.is_manager()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select exists (
    select 1 from app.employees e
    where e.user_id = auth.uid() and e.employment_status = 'active'
      and e.role in ('manager','superadmin')
  )
$$;

-- ---------- הרשאות ל-PostgREST ----------
grant usage on schema app to authenticated;
grant select, insert, update, delete on all tables in schema app to authenticated;
grant usage, select on all sequences in schema app to authenticated;
alter default privileges in schema app grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema app grant usage, select on sequences to authenticated;

-- ---------- הפעלת RLS ומדיניות "צוות בלבד" על כל טבלאות app ----------
do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'app'
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists staff_all on app.%I', t);
    execute format(
      'create policy staff_all on app.%I for all to authenticated using (app.is_staff()) with check (app.is_staff())', t);
  end loop;
end $$;

-- אירועי ביקורת: צוות רשאי להוסיף ולקרוא, אך לא לעדכן/למחוק (נאכף גם ב-0001).
drop policy if exists staff_all on audit.events;

-- ---------- קישור העובד הראשון (מנהלת) ----------
-- הרצה ידנית אחרי יצירת משתמש ב-Authentication:
--   select app.link_employee('EMAIL', 'שם מלא', 'manager');
create or replace function app.link_employee(p_email text, p_name text, p_role app.user_role default 'manager')
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_id uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'לא נמצא משתמש עם הדוא"ל %. צור אותו קודם ב-Authentication.', p_email;
  end if;
  insert into app.employees (user_id, full_name, email, role)
  values (v_uid, p_name, lower(p_email), p_role)
  on conflict (email) do update
    set user_id = excluded.user_id, full_name = excluded.full_name, role = excluded.role,
        employment_status = 'active'
  returning id into v_id;
  return v_id;
end $$;

-- === 0009_finance_access.sql ===
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

-- === 0010_bonus_engine.sql ===
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

-- === 0011_candidate_area.sql ===
-- 0011 · האזור האישי של המועמד (my.hr): קישור חשבון, פרופיל, מועמדויות,
-- מסמכים ושיחה. אזור אמון נפרד: למועמד אין גישת טבלה ישירה — מדיניות
-- staff_all (0008) מחזירה false עבורו. כל הגישה עוברת דרך פונקציות
-- SECURITY DEFINER הממוקדות תמיד לרשומת המועמד של המשתמש המחובר בלבד.

-- ---------- נרמול טלפון (זהה ללוגיקה בפונקציית ההגשה) ----------
create or replace function app.normalize_phone(raw text)
returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') as v)
  select case
    when (select v from d) = ''            then null
    when (select v from d) like '+972%'    then '+972' || regexp_replace(substr((select v from d), 5), '^0', '')
    when (select v from d) like '972%'      then '+972' || regexp_replace(substr((select v from d), 4), '^0', '')
    when (select v from d) like '0%'        then '+972' || substr((select v from d), 2)
    else (select v from d)
  end
$$;

-- ---------- מיהו המועמד המחובר ----------
create or replace function app.current_candidate()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select id from app.candidates
  where user_id = auth.uid() and anonymized_at is null
  limit 1
$$;

-- קישור חשבון ה-Auth לרשומת המועמד בכניסה הראשונה.
-- ההתאמה לפי טלפון (מפתח הכפילות) ואם אין — לפי דוא"ל. רק רשומה לא מקושרת.
-- מחזיר null אם אין רשומת מועמד (המשתמש עדיין לא הגיש למשרה).
create or replace function app.claim_candidate_profile()
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_email text; v_phone text; v_norm text; v_id uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'לא מחובר'; end if;

  select id into v_id from app.candidates
   where user_id = v_uid and anonymized_at is null limit 1;
  if v_id is not null then return v_id; end if;

  select email, phone into v_email, v_phone from auth.users where id = v_uid;
  v_norm := app.normalize_phone(v_phone);

  select id into v_id from app.candidates
   where user_id is null and anonymized_at is null
     and (
       (v_norm  is not null and phone_normalized = v_norm)
       or (v_email is not null and lower(email) = lower(v_email))
     )
   order by (v_norm is not null and phone_normalized = v_norm) desc
   limit 1;

  if v_id is not null then
    update app.candidates set user_id = v_uid where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------- פרופיל ----------
create or replace function app.my_profile()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select case when c.id is null then null else jsonb_build_object(
    'id',               c.id,
    'full_name',        c.full_name,
    'email',            c.email,
    'phone',            c.phone_raw,
    'availability',     c.availability,
    'desired_salary',   c.desired_salary,
    'years_experience', c.years_experience,
    'skills',           to_jsonb(c.skills),
    'preferences',      c.preferences,
    'editable_fields',  (select value from app.settings where key = 'candidate_area.editable_fields')
  ) end
  from (select app.current_candidate() as id) x
  left join app.candidates c on c.id = x.id
$$;

-- עדכון עצמי — רק שדות שהוגדרו כניתנים לעריכה (app.settings).
create or replace function app.update_my_profile(p jsonb)
returns jsonb
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_ed text[];
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;

  select array(select jsonb_array_elements_text(value)) into v_ed
    from app.settings where key = 'candidate_area.editable_fields';
  v_ed := coalesce(v_ed, array[]::text[]);

  update app.candidates c set
    full_name = case
      when 'full_name' = any(v_ed) and nullif(p->>'full_name', '') is not null
      then p->>'full_name' else c.full_name end,
    email = case
      when 'email' = any(v_ed) and p ? 'email'
      then nullif(p->>'email', '') else c.email end,
    availability = case
      when 'availability' = any(v_ed) and p ? 'availability'
      then nullif(p->>'availability', '') else c.availability end,
    desired_salary = case
      when 'desired_salary' = any(v_ed) and p ? 'desired_salary'
      then (nullif(p->>'desired_salary', ''))::numeric else c.desired_salary end,
    preferences = case
      when 'preferences' = any(v_ed) and p ? 'preferences'
      then coalesce(p->'preferences', '{}'::jsonb) else c.preferences end
  where c.id = v_cand;

  return app.my_profile();
end $$;

-- ---------- מועמדויות (ממופות דרך חשיפת השלבים) ----------
-- שלב לא-חשוף מקבל תווית ניטרלית; שם השלב הפנימי לעולם לא מגיע למועמד.
create or replace function app.my_applications()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',                 a.id,
    'job_title',          j.title,
    'exposed',            coalesce(se.exposed, false),
    'status_label',       case when se.exposed then coalesce(se.candidate_label, 'בתהליך') else 'בטיפול' end,
    'status_explanation', case when se.exposed then se.explanation else null end,
    'is_closed',          a.stage in ('rejected', 'withdrawn', 'job_cancelled'),
    'applied_at',         a.created_at,
    'updated_at',         a.stage_changed_at
  ) order by a.stage_changed_at desc), '[]'::jsonb)
  from app.applications a
  join app.jobs j on j.id = a.job_id
  left join app.stage_exposure se on se.stage = a.stage
  where a.candidate_id = app.current_candidate()
$$;

create or replace function app.my_application(p_id uuid)
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select case when a.id is null then null else jsonb_build_object(
    'id',                 a.id,
    'job_title',          j.title,
    'exposed',            coalesce(se.exposed, false),
    'status_label',       case when se.exposed then coalesce(se.candidate_label, 'בתהליך') else 'בטיפול' end,
    'status_explanation', case when se.exposed then se.explanation else null end,
    'is_closed',          a.stage in ('rejected', 'withdrawn', 'job_cancelled'),
    'applied_at',         a.created_at,
    'updated_at',         a.stage_changed_at,
    'interviews',         case when se.exposed and a.stage = 'interview' then (
        select coalesce(jsonb_agg(jsonb_build_object(
          'scheduled_at', iv.scheduled_at,
          'location',     iv.location,
          'status',       iv.status,
          'participants', case when iv.expose_interviewer then to_jsonb(iv.participants) else null end
        ) order by iv.scheduled_at), '[]'::jsonb)
        from app.interviews iv
        where iv.application_id = a.id and iv.status <> 'cancelled')
      else '[]'::jsonb end
  ) end
  from app.applications a
  join app.jobs j on j.id = a.job_id
  left join app.stage_exposure se on se.stage = a.stage
  where a.id = p_id and a.candidate_id = app.current_candidate()
$$;

-- ---------- מסמכים ----------
-- המועמד רואה רק מסמכים שהוא רשאי לראות (לא ערכות הגשה/סיכומים פנימיים).
create or replace function app.my_documents()
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',           d.id,
    'kind',         d.kind,
    'file_name',    d.file_name,
    'storage_path', d.storage_path,
    'size_bytes',   d.size_bytes,
    'mime_type',    d.mime_type,
    'version',      d.version,
    'created_at',   d.created_at
  ) order by d.created_at desc), '[]'::jsonb)
  from app.documents d
  where d.candidate_id = app.current_candidate()
    and d.kind in ('cv', 'cover_letter', 'certificate', 'other')
$$;

-- רישום מסמך אחרי העלאה ל-Storage. אוכף סוג/גודל לפי הגדרות הארגון,
-- ומוודא שהנתיב שייך למועמד עצמו.
create or replace function app.add_my_document(
  p_kind app.document_kind, p_storage_path text, p_file_name text, p_mime text, p_size bigint)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_max_mb numeric; v_allowed text[]; v_ver int; v_id uuid;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  if p_kind not in ('cv', 'cover_letter', 'certificate', 'other') then
    raise exception 'סוג מסמך לא מורשה להעלאה עצמית';
  end if;
  if p_size is null or p_size <= 0 then raise exception 'קובץ ריק'; end if;

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
  if p_storage_path not like (v_cand::text || '/%') then
    raise exception 'נתיב אחסון לא תקין';
  end if;

  select coalesce(max(version), 0) + 1 into v_ver
    from app.documents where candidate_id = v_cand and kind = p_kind;

  insert into app.documents
    (candidate_id, kind, version, storage_path, file_name, mime_type, size_bytes, uploaded_by, file_check)
  values
    (v_cand, p_kind, v_ver, p_storage_path, p_file_name, p_mime, p_size, auth.uid(), 'pending')
  returning id into v_id;
  return v_id;
end $$;

-- ---------- שיחה עם המגייס ----------
create or replace function app.my_messages(p_application_id uuid)
returns jsonb
language sql stable security definer set search_path = app, auth, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',         m.id,
    'from_me',    m.sender_type = 'candidate',
    'body',       m.body,
    'created_at', m.created_at
  ) order by m.created_at), '[]'::jsonb)
  from app.conversations cv
  join app.conversation_messages m on m.conversation_id = cv.id
  where cv.application_id = p_application_id
    and cv.candidate_id = app.current_candidate()
$$;

create or replace function app.send_my_message(p_application_id uuid, p_body text)
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_cand uuid; v_conv uuid; v_recruiter uuid; v_id uuid;
begin
  v_cand := app.current_candidate();
  if v_cand is null then raise exception 'אין פרופיל מועמד מקושר'; end if;
  if coalesce(nullif(trim(p_body), ''), '') = '' then raise exception 'הודעה ריקה'; end if;
  if not coalesce((select value = 'true'::jsonb from app.settings where key = 'candidate_area.chat_enabled'), true) then
    raise exception 'השיחה מושבתת';
  end if;

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
  values (v_conv, 'candidate', auth.uid(), trim(p_body))
  returning id into v_id;

  update app.conversations set last_message_at = now(), status = 'open' where id = v_conv;
  return v_id;
end $$;

-- ---------- הרשאות הרצה למשתמש מחובר ----------
grant execute on function
  app.normalize_phone(text),
  app.current_candidate(),
  app.claim_candidate_profile(),
  app.my_profile(),
  app.update_my_profile(jsonb),
  app.my_applications(),
  app.my_application(uuid),
  app.my_documents(),
  app.add_my_document(app.document_kind, text, text, text, bigint),
  app.my_messages(uuid),
  app.send_my_message(uuid, text)
to authenticated;

-- ---------- אחסון מסמכים (רק כשקיים schema של storage, כלומר על Supabase) ----------
do $$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public)
    values ('candidate-docs', 'candidate-docs', false)
    on conflict (id) do nothing;

    drop policy if exists candidate_reads_own on storage.objects;
    create policy candidate_reads_own on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs'
             and (storage.foldername(name))[1] = app.current_candidate()::text);

    drop policy if exists candidate_writes_own on storage.objects;
    create policy candidate_writes_own on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs'
                  and (storage.foldername(name))[1] = app.current_candidate()::text);

    drop policy if exists staff_reads_docs on storage.objects;
    create policy staff_reads_docs on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs' and app.is_staff());
  end if;
end $$;

-- === 0012_dev_ideas.sql ===
-- בועת הרעיונות: לכידה מהירה של רעיונות/באגים/שיפורים/הזדמנויות.
-- כלי פיתוח פרטי — גלוי ונגיש למנהל העל בלבד (המפתח), לא לצוות התפעולי.

-- זיהוי מנהל על, במקביל ל-app.is_staff()/is_manager() (0008).
create or replace function app.is_superadmin()
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select exists (
    select 1 from app.employees e
    where e.user_id = auth.uid()
      and e.employment_status = 'active'
      and e.role = 'superadmin'
  )
$$;

create table if not exists app.dev_ideas (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null default 'idea'
              check (kind in ('idea','bug','improvement','opportunity')),
  body        text not null,
  context     text,                         -- המסך/ההקשר שממנו נלכד
  status      text not null default 'open'
              check (status in ('open','in_progress','done')),
  created_at  timestamptz not null default now()
);
create index if not exists dev_ideas_user_created on app.dev_ideas (user_id, created_at desc);

-- טבלה זו נוצרה אחרי לולאת ה-RLS של 0008, ולכן אין עליה מדיניות staff_all.
-- הגישה היחידה: מנהל העל, ורק לשורות של עצמו.
alter table app.dev_ideas enable row level security;

drop policy if exists dev_ideas_superadmin on app.dev_ideas;
create policy dev_ideas_superadmin on app.dev_ideas
  for all to authenticated
  using (app.is_superadmin() and user_id = auth.uid())
  with check (app.is_superadmin() and user_id = auth.uid());

grant select, insert, update, delete on app.dev_ideas to authenticated;
grant execute on function app.is_superadmin() to authenticated;

-- === 0013_employee_management.sql ===
-- ניהול עובדים/מגייסים: כרטיס עובד מלא בסמכות מנהלת החברה —
-- פרטי העסקה, מסמכים ותעודות, ומשובים.

-- שדות HR נוספים לעובד
alter table app.employees add column if not exists job_title text;
alter table app.employees add column if not exists hire_date date;
alter table app.employees add column if not exists notes text;

-- מסמכי עובד (חוזה, תעודות, ת"ז, קורות חיים)
create table if not exists app.employee_documents (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references app.employees(id) on delete cascade,
  kind         text not null default 'other'
               check (kind in ('contract','certificate','id','resume','other')),
  file_name    text not null,
  storage_path text not null,
  mime         text,
  size_bytes   bigint,
  created_by   uuid references app.employees(id),
  created_at   timestamptz not null default now()
);
create index if not exists employee_documents_emp on app.employee_documents (employee_id, created_at desc);

-- משוב/הערכת עובד
create table if not exists app.employee_feedback (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references app.employees(id) on delete cascade,
  author_id    uuid references app.employees(id),
  rating       int check (rating between 1 and 5),
  body         text not null,
  created_at   timestamptz not null default now()
);
create index if not exists employee_feedback_emp on app.employee_feedback (employee_id, created_at desc);

-- RLS: מנהלת בלבד. הטבלאות נוצרו אחרי לולאת ה-RLS של 0008, לכן אין עליהן
-- מדיניות staff_all — הגישה היחידה היא app.is_manager().
alter table app.employee_documents enable row level security;
alter table app.employee_feedback  enable row level security;

drop policy if exists emp_docs_mgr on app.employee_documents;
create policy emp_docs_mgr on app.employee_documents for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

drop policy if exists emp_fb_mgr on app.employee_feedback;
create policy emp_fb_mgr on app.employee_feedback for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

grant select, insert, update, delete on app.employee_documents to authenticated;
grant select, insert, update, delete on app.employee_feedback  to authenticated;

-- אחסון מסמכי עובד — דלי פרטי, גישה למנהלת בלבד.
do $$ begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('employee-docs', 'employee-docs', false)
      on conflict (id) do nothing;
    drop policy if exists employee_docs_mgr on storage.objects;
    create policy employee_docs_mgr on storage.objects for all to authenticated
      using (bucket_id = 'employee-docs' and app.is_manager())
      with check (bucket_id = 'employee-docs' and app.is_manager());
  end if;
end $$;

-- === 0014_service_role_grants.sql ===
-- הרשאות ל-service_role על הסכמות app ו-finance.
-- ה-edge functions רצות כ-service_role. הרשאת service עוקפת RLS אך לא הרשאות
-- סכמה/טבלה; המיגרציות הקודמות נתנו גישה ל-authenticated בלבד, ולכן פונקציות
-- השרת קיבלו "permission denied for schema app". כאן משלימים את ההרשאות.

grant usage on schema app to service_role;
grant all on all tables in schema app to service_role;
grant all on all sequences in schema app to service_role;
grant all on all functions in schema app to service_role;
alter default privileges in schema app grant all on tables to service_role;
alter default privileges in schema app grant all on sequences to service_role;
alter default privileges in schema app grant all on functions to service_role;

grant usage on schema finance to service_role;
grant all on all tables in schema finance to service_role;
grant all on all sequences in schema finance to service_role;
grant all on all functions in schema finance to service_role;
alter default privileges in schema finance grant all on tables to service_role;
alter default privileges in schema finance grant all on sequences to service_role;
alter default privileges in schema finance grant all on functions to service_role;

-- === 0015_forms.sql ===
-- מנוע טפסים גנרי: יצירה, שליחה, מילוי (כולל חיצוני בקישור), מעקב ותיוק.
-- משתלב במערכת הקיימת — מקושר לכל ישות (מועמד/עובד/לקוח/מועמדות/השמה),
-- ממחזר את דפוסי ה-SECURITY DEFINER, האחסון הפרטי והמסמכים.

do $$ begin
  create type app.form_recipient as enum ('candidate','staff','client','general');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.form_status as enum ('created','sent','opened','started','completed');
exception when duplicate_object then null; end $$;

-- תבנית טופס. השדות והלוגיקה המותנית נשמרים כ-JSONB לגמישות מלאה.
create table if not exists app.form_templates (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text,
  recipient_type  app.form_recipient not null default 'general',
  definition      jsonb not null default '{"fields":[]}'::jsonb,   -- {fields:[{key,type,label,help,required,order,options,show_if}]}
  field_map       jsonb not null default '[]'::jsonb,               -- [{field_key,table,column,mode:auto|approve}]
  filing_target   text,                                            -- candidate|employee|company|application|placement|general
  filing_category text,
  status          text not null default 'draft' check (status in ('draft','active','archived')),
  created_by      uuid references app.employees(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- מופע טופס שנשלח/הוקצה.
create table if not exists app.form_instances (
  id               uuid primary key default gen_random_uuid(),
  template_id      uuid not null references app.form_templates(id) on delete restrict,
  token            text not null unique default encode(gen_random_bytes(18),'hex'),
  recipient_type   app.form_recipient not null default 'general',
  recipient_name   text,
  recipient_email  text,
  recipient_phone  text,
  entity_type      text check (entity_type in ('candidate','employee','company','application','placement')),
  entity_id        uuid,
  filing_category  text,
  status           app.form_status not null default 'created',
  answers          jsonb not null default '{}'::jsonb,
  sent_at          timestamptz,
  opened_at        timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  applied_at       timestamptz,                                    -- מתי מופו השדות למערכת
  created_by       uuid references app.employees(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists form_instances_entity on app.form_instances (entity_type, entity_id);
create index if not exists form_instances_template on app.form_instances (template_id, created_at desc);

create table if not exists app.form_events (
  id           uuid primary key default gen_random_uuid(),
  instance_id  uuid not null references app.form_instances(id) on delete cascade,
  kind         text not null,
  at           timestamptz not null default now(),
  meta         jsonb
);
create index if not exists form_events_instance on app.form_events (instance_id, at desc);

create trigger form_templates_touch before update on app.form_templates
  for each row execute function app.touch_updated_at();
create trigger form_instances_touch before update on app.form_instances
  for each row execute function app.touch_updated_at();

-- RLS: ניהול הטפסים לצוות (כמו שאר מודולי העבודה). נוצר אחרי לולאת 0008,
-- לכן מוגדרת כאן מדיניות staff מפורשת.
alter table app.form_templates enable row level security;
alter table app.form_instances enable row level security;
alter table app.form_events    enable row level security;

drop policy if exists form_templates_staff on app.form_templates;
create policy form_templates_staff on app.form_templates for all to authenticated
  using (app.is_staff()) with check (app.is_staff());
drop policy if exists form_instances_staff on app.form_instances;
create policy form_instances_staff on app.form_instances for all to authenticated
  using (app.is_staff()) with check (app.is_staff());
drop policy if exists form_events_staff on app.form_events;
create policy form_events_staff on app.form_events for all to authenticated
  using (app.is_staff()) with check (app.is_staff());

grant select, insert, update, delete on app.form_templates to authenticated;
grant select, insert, update, delete on app.form_instances to authenticated;
grant select, insert, update, delete on app.form_events   to authenticated;

-- ---------- גישה חיצונית לפי token (ללא התחברות) ----------
-- מוחזר רק מה שהנמען צריך: הגדרת השדות והתשובות. שדות פנימיים (מיפוי, תיוק)
-- לעולם אינם נחשפים.

create or replace function app.form_open(p_token text)
returns jsonb language plpgsql security definer set search_path = app, public as $$
declare i app.form_instances%rowtype; t app.form_templates%rowtype;
begin
  select * into i from app.form_instances where token = p_token;
  if i.id is null then return null; end if;
  select * into t from app.form_templates where id = i.template_id;
  if i.status = 'completed' then
    -- מאפשר צפייה במה שנשלח, ללא שינוי סטטוס.
    null;
  else
    update app.form_instances
       set opened_at = coalesce(opened_at, now()),
           status = case when status in ('created','sent') then 'opened' else status end
     where id = i.id;
    insert into app.form_events(instance_id, kind) values (i.id, 'opened');
  end if;
  return jsonb_build_object(
    'name', t.name, 'description', t.description,
    'definition', t.definition, 'recipient_type', t.recipient_type,
    'status', i.status, 'answers', i.answers, 'completed', (i.status='completed'));
end $$;

create or replace function app.form_save(p_token text, p_answers jsonb)
returns void language plpgsql security definer set search_path = app, public as $$
declare i app.form_instances%rowtype;
begin
  select * into i from app.form_instances where token = p_token;
  if i.id is null then raise exception 'טופס לא נמצא'; end if;
  if i.status = 'completed' then raise exception 'הטופס כבר הושלם'; end if;
  update app.form_instances
     set answers = coalesce(p_answers,'{}'::jsonb),
         status = case when status in ('created','sent','opened') then 'started' else status end,
         started_at = coalesce(started_at, now())
   where id = i.id;
end $$;

create or replace function app.form_submit(p_token text, p_answers jsonb)
returns void language plpgsql security definer set search_path = app, public as $$
declare i app.form_instances%rowtype;
begin
  select * into i from app.form_instances where token = p_token;
  if i.id is null then raise exception 'טופס לא נמצא'; end if;
  if i.status = 'completed' then raise exception 'הטופס כבר הושלם'; end if;
  update app.form_instances
     set answers = coalesce(p_answers,'{}'::jsonb),
         status = 'completed', completed_at = now(),
         started_at = coalesce(started_at, now())
   where id = i.id;
  insert into app.form_events(instance_id, kind) values (i.id, 'completed');
end $$;

grant execute on function app.form_open(text)         to anon, authenticated;
grant execute on function app.form_save(text, jsonb)  to anon, authenticated;
grant execute on function app.form_submit(text, jsonb) to anon, authenticated;

-- אחסון קבצים/חתימות מטפסים — דלי פרטי. צוות קורא; העלאה מאובטחת מטופלת
-- בהמשך דרך הרשאות ממוקדות. כרגע: קריאה לצוות, כתיבה למחוברים בלבד.
do $$ begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('form-uploads','form-uploads', false)
      on conflict (id) do nothing;
    drop policy if exists form_uploads_staff_read on storage.objects;
    create policy form_uploads_staff_read on storage.objects for select to authenticated
      using (bucket_id = 'form-uploads' and app.is_staff());
  end if;
end $$;

-- === 0016_form_seeds_apply.sql ===
-- הפיכת טופס ההגשה באתר לניתן־עריכה מהמערכת, וזריעת תבניות טפסים מוכנות.
-- (1) דגל is_site_apply על תבנית — קובעת אילו שאלות נוספות מוצגות בטופס
--     ההגשה הציבורי, מעבר לשדות הבסיס (שם/טלפון/דוא״ל/קו״ח/הסכמה).
-- (2) עמודת answers על applications — לאחסון תשובות השאלות הנוספות.
-- (3) פונקציה ציבורית שמחזירה את שדות טופס ההגשה הפעיל (ללא התחברות).
-- (4) זריעת תבניות מוכנות לעריכה מיידית בבנאי.

-- ---------- (1) דגל טופס ההגשה באתר ----------
alter table app.form_templates add column if not exists is_site_apply boolean not null default false;
-- רק תבנית אחת יכולה לשמש כטופס ההגשה באתר בו־זמנית.
create unique index if not exists form_templates_site_apply_one
  on app.form_templates (is_site_apply) where is_site_apply;

-- ---------- (2) תשובות השאלות הנוספות בהגשה ----------
alter table app.applications add column if not exists answers jsonb not null default '{}'::jsonb;

-- ---------- (3) חשיפת שדות טופס ההגשה הפעיל (ציבורי) ----------
-- מחזיר רק את הגדרת השדות הציבורית — לעולם לא מיפוי/תיוק/מטא פנימי.
create or replace function app.site_apply_form()
returns jsonb language sql stable security definer set search_path = app, public as $$
  select coalesce(
    (select jsonb_build_object(
       'name', name, 'description', description,
       'fields', coalesce(definition->'fields', '[]'::jsonb))
     from app.form_templates
     where is_site_apply and status = 'active' limit 1),
    jsonb_build_object('fields', '[]'::jsonb));
$$;
grant execute on function app.site_apply_form() to anon, authenticated;

-- ---------- (4) תבניות מוכנות (idempotent — לפי שם) ----------
insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'קליטת עובד חדש',
  'טופס קליטה לעובד/מגייס חדש — פרטים אישיים, פרטי בנק ותחילת עבודה.',
  'staff', $json${
  "fields":[
    {"key":"h_personal","type":"heading","label":"פרטים אישיים","order":0},
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":1},
    {"key":"id_number","type":"text","label":"תעודת זהות","required":true,"order":2},
    {"key":"birth_date","type":"date","label":"תאריך לידה","order":3},
    {"key":"phone","type":"text","label":"טלפון","required":true,"order":4},
    {"key":"email","type":"text","label":"דוא״ל","required":true,"order":5},
    {"key":"address","type":"textarea","label":"כתובת מגורים","order":6},
    {"key":"h_bank","type":"heading","label":"פרטי חשבון בנק","order":7},
    {"key":"bank_name","type":"text","label":"בנק","order":8},
    {"key":"bank_branch","type":"text","label":"סניף","order":9},
    {"key":"bank_account","type":"text","label":"מספר חשבון","order":10},
    {"key":"h_start","type":"heading","label":"תחילת עבודה","order":11},
    {"key":"start_date","type":"date","label":"תאריך תחילת עבודה","order":12},
    {"key":"emergency_name","type":"text","label":"איש קשר לחירום","order":13},
    {"key":"emergency_phone","type":"text","label":"טלפון איש קשר לחירום","order":14},
    {"key":"signature","type":"signature","label":"חתימת העובד","required":true,"order":15}
  ]}$json$::jsonb,
  'employee', 'קליטה', 'active'
where not exists (select 1 from app.form_templates where name = 'קליטת עובד חדש');

insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'הצהרת בריאות',
  'הצהרת בריאות למועמד/עובד לפני תחילת עבודה.',
  'candidate', $json${
  "fields":[
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":0},
    {"key":"id_number","type":"text","label":"תעודת זהות","required":true,"order":1},
    {"key":"health_ok","type":"boolean","label":"אני בריא/ה וכשיר/ה לעבודה","required":true,"order":2},
    {"key":"has_condition","type":"boolean","label":"קיימת מגבלה רפואית הרלוונטית לתפקיד","order":3},
    {"key":"condition_details","type":"textarea","label":"פירוט המגבלה","help":"למילוי רק אם קיימת מגבלה","show_if":{"field":"has_condition","equals":"כן"},"order":4},
    {"key":"declaration","type":"boolean","label":"ההצהרה נכונה ומדויקת","required":true,"order":5},
    {"key":"signature","type":"signature","label":"חתימה","required":true,"order":6}
  ]}$json$::jsonb,
  'employee', 'אישורים', 'active'
where not exists (select 1 from app.form_templates where name = 'הצהרת בריאות');

insert into app.form_templates (name, description, recipient_type, definition, field_map, filing_target, filing_category, status)
select 'אישור ועדכון פרטים אישיים',
  'המועמד מאשר ומעדכן את הפרטים שלו במערכת.',
  'candidate', $json${
  "fields":[
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":0},
    {"key":"phone","type":"text","label":"טלפון","required":true,"order":1},
    {"key":"email","type":"text","label":"דוא״ל","order":2},
    {"key":"availability","type":"select","label":"זמינות לעבודה","options":[{"value":"מיידית","label":"מיידית"},{"value":"תוך חודש","label":"תוך חודש"},{"value":"גמיש","label":"גמיש"}],"order":3},
    {"key":"confirm","type":"boolean","label":"הפרטים נכונים ומעודכנים","required":true,"order":4}
  ]}$json$::jsonb,
  $json$[
    {"field_key":"full_name","table":"candidates","column":"full_name","mode":"approve"},
    {"field_key":"phone","table":"candidates","column":"phone_raw","mode":"approve"},
    {"field_key":"email","table":"candidates","column":"email","mode":"approve"},
    {"field_key":"availability","table":"candidates","column":"availability","mode":"approve"}
  ]$json$::jsonb,
  'candidate', 'מסמכי מועמד', 'active'
where not exists (select 1 from app.form_templates where name = 'אישור ועדכון פרטים אישיים');

-- תבנית לדוגמה לטופס ההגשה באתר. is_site_apply נשאר כבוי — המנהלת מדליקה
-- אותה בבנאי כשתהיה מוכנה, כדי שלא לשנות את התנהגות האתר הקיים באופן אוטומטי.
insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'שאלות נוספות להגשת מועמדות (אתר)',
  'שאלות שמוצגות בטופס ההגשה הציבורי מתחת לשדות הבסיס. הדליקו "טופס ההגשה באתר" כדי להפעיל.',
  'candidate', $json${
  "fields":[
    {"key":"city","type":"text","label":"עיר מגורים","order":0},
    {"key":"availability","type":"select","label":"זמינות לעבודה","options":[{"value":"מיידית","label":"מיידית"},{"value":"תוך חודש","label":"תוך חודש"},{"value":"גמיש","label":"גמיש"}],"order":1},
    {"key":"source","type":"select","label":"איך הגעת אלינו?","options":[{"value":"חיפוש בגוגל","label":"חיפוש בגוגל"},{"value":"רשתות חברתיות","label":"רשתות חברתיות"},{"value":"המלצה","label":"המלצה"},{"value":"אחר","label":"אחר"}],"order":2},
    {"key":"linkedin","type":"text","label":"קישור לפרופיל LinkedIn","order":3}
  ]}$json$::jsonb,
  'application', 'גיוס', 'active'
where not exists (select 1 from app.form_templates where name = 'שאלות נוספות להגשת מועמדות (אתר)');

-- === 0017_public_form_access.sql ===
-- תיקון גישת טפסים ציבוריים (מילוי לפי token ללא התחברות).
-- הבעיה: מבקר לא מחובר הוא בתפקיד anon, ול-anon לא הייתה הרשאת USAGE על
-- סכמת app — לכן קריאת app.form_open נכשלה ב-"permission denied for schema app",
-- והמסך הציג "הטופס לא נמצא".
--
-- אבטחה: ברירת המחדל של Postgres מעניקה EXECUTE ל-PUBLIC על כל פונקציה. בסכמת
-- app יש פונקציות SECURITY DEFINER רגישות (מנוע בונוסים, כספים, אזור המועמד).
-- עד היום anon נחסם רק בכך שלא הייתה לו גישה לסכמה. לכן, לפני שמעניקים ל-anon
-- USAGE על הסכמה, מבטלים את EXECUTE הגורף מ-PUBLIC ומעניקים אותו מחדש במפורש
-- ל-authenticated (שימור המצב הקיים בדיוק), ורק את ארבע פונקציות ה-token
-- הציבוריות מעניקים ל-anon.

-- 1) ביטול ה-EXECUTE הגורף שמגיע מ-PUBLIC (משפיע גם על anon).
revoke execute on all functions in schema app from public;

-- 2) שימור ההתנהגות הקיימת: authenticated ו-service_role ממשיכים להריץ הכול.
grant execute on all functions in schema app to authenticated;
grant execute on all functions in schema app to service_role;

-- 3) גישת קריאה לסכמה ל-anon (בלי הרשאות טבלה — RLS ממשיך לחסום, ואין ל-anon
--    שום GRANT על טבלאות app).
grant usage on schema app to anon;

-- 4) הענקת EXECUTE ל-anon רק לפונקציות ה-token הציבוריות והבטוחות.
grant execute on function app.form_open(text)          to anon;
grant execute on function app.form_save(text, jsonb)   to anon;
grant execute on function app.form_submit(text, jsonb) to anon;
grant execute on function app.site_apply_form()        to anon;

-- === 0018_custom_fields.sql ===
-- מנוע שדות מותאמים (ללא קוד): המנהלת מגדירה שדות נוספים לכל סוג ישות
-- (מועמד/משרה/לקוח/תהליך גיוס), והם מופיעים בכרטיסים ובטפסי העריכה — בלי מפתח.
-- ההגדרות יושבות ב-custom_fields; הערכים ב-jsonb על כל ישות (custom).

create table if not exists app.custom_fields (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('candidate','job','company','application')),
  key          text not null,                 -- מזהה יציב לשדה (נשמר ב-custom)
  label        text not null,                 -- תווית בעברית
  type         text not null default 'text'
               check (type in ('text','textarea','number','date','boolean','select','multiselect')),
  help         text,
  required     boolean not null default false,
  options      jsonb not null default '[]'::jsonb,  -- [{value,label}] לסוגי בחירה
  sort         integer not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (entity_type, key)
);
create index if not exists custom_fields_entity on app.custom_fields (entity_type, sort);

create trigger custom_fields_touch before update on app.custom_fields
  for each row execute function app.touch_updated_at();

-- ערכי השדות המותאמים על כל ישות.
alter table app.jobs         add column if not exists custom jsonb not null default '{}'::jsonb;
alter table app.candidates   add column if not exists custom jsonb not null default '{}'::jsonb;
alter table app.companies    add column if not exists custom jsonb not null default '{}'::jsonb;
alter table app.applications add column if not exists custom jsonb not null default '{}'::jsonb;

-- RLS: כל הצוות רואה את ההגדרות (כדי לרנדר); רק מנהלת יוצרת/עורכת/מוחקת.
alter table app.custom_fields enable row level security;
drop policy if exists custom_fields_read  on app.custom_fields;
drop policy if exists custom_fields_write on app.custom_fields;
create policy custom_fields_read  on app.custom_fields for select to authenticated
  using (app.is_staff());
create policy custom_fields_write on app.custom_fields for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

grant select, insert, update, delete on app.custom_fields to authenticated;

-- === 0019_job_stage_history.sql ===
-- לוג שינויי סטטוס למשרה + תחזוקה אוטומטית של תאריכי פתיחה/סגירה.
-- מזין את "לוג השינויים" בכרטיס המשרה, ותופס כל שינוי סטטוס — גם מרשימת
-- המשרות (פרסום) וגם מהכרטיס.

create table if not exists app.job_stage_history (
  id          bigserial primary key,
  job_id      uuid not null references app.jobs(id) on delete cascade,
  from_stage  app.job_stage,
  to_stage    app.job_stage not null,
  reason      text,
  changed_by  uuid references app.employees(id),
  changed_at  timestamptz not null default now()
);
create index if not exists job_stage_history_job on app.job_stage_history (job_id, changed_at desc);

-- BEFORE: תחזוקת opened_at/closed_at לפי הסטטוס.
create or replace function app.jobs_stage_dates()
returns trigger language plpgsql set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    if new.stage = 'open' and new.opened_at is null then new.opened_at := current_date; end if;
    if new.stage in ('closed','filled') and new.closed_at is null then new.closed_at := current_date; end if;
    -- פתיחה מחדש מנקה את תאריך הסגירה.
    if new.stage in ('open','on_hold','draft') then new.closed_at := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_stage_dates on app.jobs;
create trigger jobs_stage_dates before update on app.jobs
  for each row execute function app.jobs_stage_dates();

-- AFTER: רישום שינוי הסטטוס בלוג (SECURITY DEFINER כדי לכתוב ללוג בלי תלות ב-RLS).
create or replace function app.jobs_log_stage()
returns trigger language plpgsql security definer set search_path = app, public as $$
begin
  if new.stage is distinct from old.stage then
    insert into app.job_stage_history (job_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, app.current_employee());
  end if;
  return null;
end $$;
drop trigger if exists jobs_log_stage on app.jobs;
create trigger jobs_log_stage after update on app.jobs
  for each row execute function app.jobs_log_stage();

-- RLS: הצוות קורא את הלוג.
alter table app.job_stage_history enable row level security;
drop policy if exists job_stage_history_read on app.job_stage_history;
create policy job_stage_history_read on app.job_stage_history for select to authenticated
  using (app.is_staff());
grant select on app.job_stage_history to authenticated;

-- === 0020_fix_compute_bonus.sql ===
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

-- === 0021_fix_bonus_unnest.sql ===
-- הבאג האמיתי מאחורי "a column definition list is redundant for a function
-- returning a named composite type": בגוף compute_monthly_bonus היה
--   unnest(inp) as u(placement_id uuid, commission numeric, start_date date)
-- אבל finance.bonus_input הוא טיפוס מורכב מוגדר, ואי אפשר לצרף ל-unnest שלו
-- רשימת הגדרת עמודות. השגיאה מתרחשת בזמן ריצה, בענף של מטריקת סכום העמלות
-- (ולכן הופיעה רק לחלק מהמגייסים). התיקון: unnest ... as u ואז u.commission.

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
                   order by p.verified_start_date, p.id) into inp
  from finance.placements p
  where p.recruiter_id = p_employee
    and p.verified_start_date between m0 and m1
    and p.status in ('working_warranty','approved');

  insert into finance.bonus_calculations (employee_id, period_month, plan_id, plan_version, status)
  values (p_employee, m0, pl.id, pl.version, 'draft')
  on conflict (employee_id, period_month) do update
    set plan_id = excluded.plan_id, plan_version = excluded.plan_version, updated_at = now()
  returning id into calc_id;

  delete from finance.bonus_calculation_lines where calculation_id = calc_id and placement_id is not null;
  insert into finance.bonus_calculation_lines (calculation_id, placement_id, expected_commission, tier, pct, amount)
  select calc_id, l.placement_id, l.base, l.tier, l.pct, l.amount
  from finance.calc_bonus_lines(pl.metric, pl.target_a, pl.target_b, pl.pct_tier_1, pl.pct_tier_2, coalesce(inp,'{}'::finance.bonus_input[])) l
  where l.placement_id is not null;

  update finance.bonus_calculations c set
    metric_value = case when pl.metric = 'placements_count'
                        then (select count(*)::numeric from unnest(coalesce(inp,'{}'::finance.bonus_input[])))
                        else (select coalesce(sum(u.commission),0) from unnest(coalesce(inp,'{}'::finance.bonus_input[])) as u) end,
    total_amount = (select coalesce(sum(amount),0) from finance.bonus_calculation_lines where calculation_id = calc_id)
  where c.id = calc_id;
  return calc_id;
end $$;

notify pgrst, 'reload schema';

-- === 0022_security_hardening.sql ===
-- 0022 · הקשחת אבטחה: הרשאות, RLS מודע-היקף, יומן ביקורת והסתרת שדות כספיים.
-- מטפל בממצאי הביקורת C1, C2, C3, H9, H10, H11, M3, M8, M9, M13, L5.
--
-- הרעיון המרכזי: עד כה מדיניות אחת גורפת (staff_all, 0008:41-52) נתנה לכל עובד
-- פעיל CRUD מלא על כל טבלאות app — כולל התפקיד של עצמו, ההגדרות וההרשאות.
-- כאן מפרקים אותה לארבע מדיניות נפרדות (קריאה/הוספה/עדכון/מחיקה), מוסיפים
-- טבלאות שרק מנהלת כותבת אליהן, ומכניסים היקפי הרשאה (שלי/צוות/הכל) לתוך RLS.
-- הקובץ idempotent: אפשר להריץ אותו שוב על אותו מסד.

-- ============================================================================
-- 1. עזרי היקף (C3) — מטריצת ההרשאות הופכת מנתונים מתים לכלל אכיפה
-- ============================================================================

-- הצוות של המשתמש המחובר (לצורך היקף "הצוות שלי").
create or replace function app.my_team()
returns uuid
language sql stable security definer set search_path = app, auth, public as $$
  select e.team_id from app.employees e
  where e.user_id = auth.uid() and e.employment_status = 'active'
  limit 1
$$;

-- ההיקף האפקטיבי של המשתמש המחובר למודול/פעולה:
--   ברירת מחדל לתפקיד  ->  כללי פרופילים  ->  עקיפות פר משתמש.
-- שלילה פר משתמש גוברת על הכול (אפיון, סעיף מטריצת ההרשאות, כלל 1).
-- עקיפה שפג תוקפה אינה נספרת (כלל 5).
-- אם אין אף שורה מתאימה מחזירים 'all' — כלומר ההתנהגות שהייתה עד היום,
-- כדי שהוספת מודול חדש לא תנעל בשוגג את המערכת.
create or replace function app.effective_scope(p_module text, p_action text)
returns text
language plpgsql stable security definer set search_path = app, auth, public as $$
declare
  v_mod   app.perm_module;
  v_act   app.perm_action;
  v_emp   app.employees%rowtype;
  v_scope app.perm_scope;
begin
  begin
    v_mod := p_module::app.perm_module;
    v_act := p_action::app.perm_action;
  exception when others then
    return 'all';   -- מודול/פעולה שאינם במטריצה: לא חוסמים
  end;

  select * into v_emp from app.employees
   where user_id = auth.uid() and employment_status = 'active'
   limit 1;
  if v_emp.id is null then return 'none'; end if;

  -- מנהלת ומנהל על נשארים 'all' (אפיון, טבלת ברירות המחדל).
  if v_emp.role in ('manager','superadmin') then return 'all'; end if;

  if exists (
    select 1 from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = v_mod and o.action = v_act
       and o.kind = 'deny'
       and (o.valid_until is null or o.valid_until > now())
  ) then
    return 'none';
  end if;

  select max(s) into v_scope from (
    select d.scope as s
      from app.permission_defaults d
     where d.role = v_emp.role and d.module = v_mod and d.action = v_act
    union all
    select r.scope
      from app.permission_profile_rules r
      join app.employee_permission_profiles ep on ep.profile_id = r.profile_id
     where ep.employee_id = v_emp.id and r.module = v_mod and r.action = v_act
    union all
    select o.scope
      from app.permission_overrides o
     where o.employee_id = v_emp.id and o.module = v_mod and o.action = v_act
       and o.kind = 'grant'
       and (o.valid_until is null or o.valid_until > now())
  ) x;

  if v_scope is null then return 'all'; end if;
  return v_scope::text;
end $$;

-- האם שורה שבבעלות p_owner נמצאת בהיקף p_scope עבור המשתמש p_me.
-- שורה ללא אחראי (owner is null) נחשבת מאגר משותף — כך שמועמד שנוצר
-- מהאתר הציבורי אינו הופך לבלתי ניתן לעריכה לאיש מלבד המנהלת.
create or replace function app.owner_in_scope(
  p_scope text, p_me uuid, p_my_team uuid, p_owner uuid)
returns boolean
language sql stable security definer set search_path = app, public as $$
  select case
    when p_scope is null   then true
    when p_scope = 'all'   then true
    when p_scope = 'none'  then false
    when p_owner is null   then true
    when p_scope = 'own'   then p_owner = p_me
    when p_scope = 'team'  then p_owner = p_me
                              or (p_my_team is not null and exists (
                                    select 1 from app.employees o
                                     where o.id = p_owner and o.team_id = p_my_team))
    else true
  end
$$;

-- ============================================================================
-- 2. נעילת כרטיס העובד (C2) — אי אפשר לקדם את עצמך
-- ============================================================================
-- הטריגר חל על כל עדכון, גם כזה שעוקף RLS דרך PostgREST. הקשר ללא JWT
-- (postgres מה-SQL Editor, service_role מפונקציות הקצה) מזוהה לפי
-- auth.uid() is null ומורשה — שם ההגנה היא ההרשאה להתחבר בכלל.
create or replace function app.guard_employee_privileges()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if auth.uid() is null then
    return new;   -- הקשר שרת (service_role / SQL Editor)
  end if;

  if (new.role is distinct from old.role
      or new.employment_status is distinct from old.employment_status
      or new.user_id is distinct from old.user_id)
     and not app.is_manager() then
    raise exception 'שינוי תפקיד, סטטוס העסקה או חשבון משתמש שמור למנהלת בלבד';
  end if;

  if new.role = 'superadmin' and old.role is distinct from 'superadmin'
     and not app.is_superadmin() then
    raise exception 'רק מנהל על יכול להעניק תפקיד מנהל על';
  end if;

  return new;
end $$;

drop trigger if exists guard_employee_privileges on app.employees;
create trigger guard_employee_privileges before update on app.employees
  for each row execute function app.guard_employee_privileges();

-- M9: אותו חשבון auth אינו יכול להיות גם עובד וגם מועמד (אפיון, מודל המידע).
create or replace function app.guard_user_identity()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if new.user_id is null then return new; end if;
  if tg_table_name = 'employees' then
    if exists (select 1 from app.candidates c where c.user_id = new.user_id) then
      raise exception 'חשבון זה כבר משויך למועמד ואינו יכול לשמש כעובד';
    end if;
  else
    if exists (select 1 from app.employees e where e.user_id = new.user_id) then
      raise exception 'חשבון זה כבר משויך לעובד ואינו יכול לשמש כמועמד';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_user_identity on app.employees;
create trigger guard_user_identity before insert or update of user_id on app.employees
  for each row execute function app.guard_user_identity();
drop trigger if exists guard_user_identity on app.candidates;
create trigger guard_user_identity before insert or update of user_id on app.candidates
  for each row execute function app.guard_user_identity();

-- ============================================================================
-- 3. יומן ביקורת (H9) — מהיום באמת נכתב אליו
-- ============================================================================
grant usage on schema audit to authenticated;
grant select, insert on audit.events to authenticated;
grant usage, select on sequence audit.events_id_seq to authenticated;
grant usage on schema audit to service_role;
grant all on audit.events to service_role;
grant usage, select on sequence audit.events_id_seq to service_role;
revoke update, delete, truncate on audit.events from public, authenticated;

alter table audit.events enable row level security;
drop policy if exists audit_insert_staff on audit.events;
create policy audit_insert_staff on audit.events for insert to authenticated
  with check ((select app.is_staff()) and actor_id = auth.uid());
drop policy if exists audit_read_manager on audit.events;
create policy audit_read_manager on audit.events for select to authenticated
  using ((select app.is_manager()));

-- טריגר גנרי: מי עשה, על מה, מה היה ומה נהיה.
create or replace function audit.log_change()
returns trigger
language plpgsql security definer set search_path = app, audit, auth, public as $$
declare
  v_actor uuid := auth.uid();
  v_label text;
  v_old   jsonb;
  v_new   jsonb;
  v_key   text;
begin
  if v_actor is not null then
    select e.full_name into v_label from app.employees e where e.user_id = v_actor limit 1;
    -- actor_id מצביע ל-auth.users; אם המשתמש אינו שם (בדיקות) לא מפילים פעולה עסקית.
    if not exists (select 1 from auth.users u where u.id = v_actor) then
      v_actor := null;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  end if;

  v_key := coalesce(v_new->>'id', v_old->>'id', v_new->>'key', v_old->>'key',
                    v_new->>'stage', v_old->>'stage',
                    v_new->>'employee_id', v_old->>'employee_id');

  insert into audit.events (actor_id, actor_label, action, entity_type, entity_id, changes)
  values (v_actor, v_label, lower(tg_op), tg_table_schema || '.' || tg_table_name, v_key,
          jsonb_strip_nulls(jsonb_build_object('old', v_old, 'new', v_new)));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'employees','settings','permission_defaults','permission_profiles',
    'permission_profile_rules','employee_permission_profiles','permission_overrides',
    'agreements','stage_exposure']
  loop
    execute format('drop trigger if exists audit_log on app.%I', t);
    execute format(
      'create trigger audit_log after insert or update or delete on app.%I
         for each row execute function audit.log_change()', t);
  end loop;
end $$;

-- ============================================================================
-- 4. פירוק staff_all לארבע מדיניות (C2)
-- ============================================================================
-- קריאה: כל עובד פעיל. כתיבה: עובד פעיל, ובטבלאות ההגדרות/ההרשאות/המסחר —
-- מנהלת בלבד. מחיקה: מנהלת, למעט טבלאות תפעוליות שהאפליקציה מוחקת מהן בפועל.
-- כל קריאה ל-is_staff()/is_manager() עטופה ב-(select ...) כדי שתוערך פעם אחת
-- לשאילתה ולא לכל שורה (M13).
do $$
declare
  t          text;
  wr         text;
  del        text;
  mgr_write  text[] := array[
    'settings','teams','permission_defaults','permission_profiles',
    'permission_profile_rules','employee_permission_profiles','permission_overrides',
    'agreements','stage_exposure','automation_rules','job_publications'];
  -- טבלאות עם מדיניות ייעודית משלהן (כאן או במיגרציות קודמות)
  skip_tables text[] := array[
    'dev_ideas','employee_documents','employee_feedback','custom_fields',
    'job_stage_history','form_templates','form_instances','form_events',
    'public_submission_log','employees','candidates','jobs','applications',
    'application_stage_history'];
  -- שורות תפעוליות שהצוות מוחק בעבודה השוטפת
  staff_delete text[] := array[
    'documents','document_analyses','candidate_consents','client_submissions',
    'interviews','conversations','conversation_messages','activities',
    'task_assignees','task_links','task_reminders','saved_jobs','job_alerts',
    'outbound_messages','task_process_items'];
begin
  for t in select tablename from pg_tables where schemaname = 'app' order by tablename loop
    execute format('alter table app.%I enable row level security', t);
    execute format('drop policy if exists staff_all on app.%I', t);
    continue when t = any(skip_tables);

    wr  := case when t = any(mgr_write) then '(select app.is_manager())' else '(select app.is_staff())' end;
    del := case when t = any(mgr_write) then '(select app.is_manager())'
                when t = any(staff_delete) then '(select app.is_staff())'
                else '(select app.is_manager())' end;

    execute format('drop policy if exists staff_read on app.%I', t);
    execute format('create policy staff_read on app.%I for select to authenticated using ((select app.is_staff()))', t);
    execute format('drop policy if exists staff_write on app.%I', t);
    execute format('create policy staff_write on app.%I for insert to authenticated with check (%s)', t, wr);
    execute format('drop policy if exists staff_update on app.%I', t);
    execute format('create policy staff_update on app.%I for update to authenticated using (%s) with check (%s)', t, wr, wr);
    execute format('drop policy if exists row_delete on app.%I', t);
    execute format('create policy row_delete on app.%I for delete to authenticated using (%s)', t, del);
  end loop;
end $$;

-- ---------- עובדים ----------
-- קריאה לכל הצוות (הממשק מציג שמות אחראים); הוספה ומחיקה למנהלת;
-- עדכון למנהלת או לשורה של עצמי — והטריגר שלמעלה חוסם העלאת הרשאות.
alter table app.employees enable row level security;
drop policy if exists employees_read on app.employees;
create policy employees_read on app.employees for select to authenticated
  using ((select app.is_staff()));
drop policy if exists employees_insert on app.employees;
create policy employees_insert on app.employees for insert to authenticated
  with check ((select app.is_manager()));
drop policy if exists employees_update on app.employees;
create policy employees_update on app.employees for update to authenticated
  using ((select app.is_manager()) or user_id = auth.uid())
  with check ((select app.is_manager()) or user_id = auth.uid());
drop policy if exists employees_delete on app.employees;
create policy employees_delete on app.employees for delete to authenticated
  using ((select app.is_manager()));

-- ---------- מועמדים, משרות ומועמדויות: RLS מודע-היקף (C3) ----------
alter table app.candidates enable row level security;
drop policy if exists candidates_read on app.candidates;
create policy candidates_read on app.candidates for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','view')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id));
drop policy if exists candidates_insert on app.candidates;
create policy candidates_insert on app.candidates for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('candidates','create')) <> 'none');
drop policy if exists candidates_update on app.candidates;
create policy candidates_update on app.candidates for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','edit')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('candidates','edit')),
           (select app.current_employee()), (select app.my_team()), owner_employee_id));
drop policy if exists candidates_delete on app.candidates;
create policy candidates_delete on app.candidates for delete to authenticated
  using ((select app.is_manager()));

alter table app.jobs enable row level security;
drop policy if exists jobs_read on app.jobs;
create policy jobs_read on app.jobs for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','view')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists jobs_insert on app.jobs;
create policy jobs_insert on app.jobs for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('jobs','create')) <> 'none');
drop policy if exists jobs_update on app.jobs;
create policy jobs_update on app.jobs for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('jobs','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists jobs_delete on app.jobs;
create policy jobs_delete on app.jobs for delete to authenticated
  using ((select app.is_manager()));

alter table app.applications enable row level security;
drop policy if exists applications_read on app.applications;
create policy applications_read on app.applications for select to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','view')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists applications_insert on app.applications;
create policy applications_insert on app.applications for insert to authenticated
  with check ((select app.is_staff()) and (select app.effective_scope('applications','create')) <> 'none');
drop policy if exists applications_update on app.applications;
create policy applications_update on app.applications for update to authenticated
  using ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id))
  with check ((select app.is_staff()) and app.owner_in_scope(
           (select app.effective_scope('applications','edit')),
           (select app.current_employee()), (select app.my_team()), recruiter_id));
drop policy if exists applications_delete on app.applications;
create policy applications_delete on app.applications for delete to authenticated
  using ((select app.is_manager()));

-- ---------- היסטוריית שלבים: קריאה בלבד ללקוח (H9) ----------
-- הכתיבה עוברת מהיום דרך app.set_application_stage (0023), בדיוק כמו
-- job_stage_history שנכתב מטריגר בלבד (0019).
alter table app.application_stage_history enable row level security;
drop policy if exists ash_read on app.application_stage_history;
create policy ash_read on app.application_stage_history for select to authenticated
  using ((select app.is_staff()));
revoke insert, update, delete on app.application_stage_history from authenticated;
revoke update, delete on app.job_stage_history from authenticated;

-- ---------- טפסים (M2) ----------
-- מופע טופס מכיל ת"ז, פרטי בנק והצהרות בריאות. מהיום נחשף ליוצר ולמנהלת בלבד.
alter table app.form_instances enable row level security;
drop policy if exists form_instances_staff on app.form_instances;
drop policy if exists form_instances_owner on app.form_instances;
create policy form_instances_owner on app.form_instances for all to authenticated
  using ((select app.is_manager()) or created_by = (select app.current_employee()))
  with check ((select app.is_manager()) or created_by = (select app.current_employee()));

alter table app.form_events enable row level security;
drop policy if exists form_events_staff on app.form_events;
drop policy if exists form_events_owner on app.form_events;
create policy form_events_owner on app.form_events for all to authenticated
  using ((select app.is_manager()) or exists (
           select 1 from app.form_instances i
            where i.id = instance_id and i.created_by = (select app.current_employee())))
  with check ((select app.is_manager()) or exists (
           select 1 from app.form_instances i
            where i.id = instance_id and i.created_by = (select app.current_employee())));

-- תבניות: קריאה לכל הצוות (צריך כדי לשלוח טופס), עריכה למנהלת.
alter table app.form_templates enable row level security;
drop policy if exists form_templates_staff on app.form_templates;
drop policy if exists form_templates_read on app.form_templates;
drop policy if exists form_templates_write on app.form_templates;
create policy form_templates_read on app.form_templates for select to authenticated
  using ((select app.is_staff()));
create policy form_templates_write on app.form_templates for all to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

-- ============================================================================
-- 5. קישור עובד — נעילת מסלול ההסלמה (C1)
-- ============================================================================
-- הפונקציה נועדה להרצה ידנית אחת מה-SQL Editor. היא נשארת, אבל:
--   (א) ה-EXECUTE נשלל מ-public/anon/authenticated — אי אפשר לקרוא לה מ-REST.
--   (ב) גם אם תוענק שוב בטעות, היא מסרבת אלא אם: אין אף עובד במערכת (bootstrap),
--       או שהקורא מנהל על, או שזו הרצה ישירה מהמסד ללא JWT.
-- current_user חסר ערך כאן: בפונקציית SECURITY DEFINER הוא תמיד בעל הפונקציה.
-- לכן נבדקים session_user (רול ההתחברות האמיתי) ו-auth.uid().
create or replace function app.link_employee(p_email text, p_name text, p_role app.user_role default 'manager')
returns uuid
language plpgsql security definer set search_path = app, auth, public as $$
declare v_uid uuid; v_id uuid; v_any boolean;
begin
  select exists (select 1 from app.employees) into v_any;
  if v_any
     and not app.is_superadmin()
     and not (auth.uid() is null and session_user in ('postgres','supabase_admin')) then
    raise exception 'app.link_employee שמורה למנהל על או להרצה ישירה מהמסד';
  end if;

  select id into v_uid from auth.users where lower(email) = lower(p_email);
  if v_uid is null then
    raise exception 'לא נמצא משתמש עם הדוא"ל %. צור אותו קודם ב-Authentication.', p_email;
  end if;
  insert into app.employees (user_id, full_name, email, role)
  values (v_uid, p_name, lower(p_email), p_role)
  on conflict (email) do update
    set user_id = excluded.user_id, full_name = excluded.full_name, role = excluded.role,
        employment_status = 'active'
  returning id into v_id;
  return v_id;
end $$;

-- ניתוק חשבון משתמש מרשומת מועמד (H12) — מסלול התיקון כשקישור שגוי קרה.
create or replace function app.unlink_candidate_user(p_candidate_id uuid)
returns void
language plpgsql security definer set search_path = app, auth, public as $$
begin
  if not app.is_manager() then raise exception 'רק מנהלת מנתקת חשבון מועמד'; end if;
  update app.candidates set user_id = null where id = p_candidate_id;
end $$;

-- ============================================================================
-- 6. הרשאות הרצה והרשאות ברירת מחדל (H11, M3)
-- ============================================================================
-- 0017 ביטלה את ה-EXECUTE הגורף מ-PUBLIC אך לא קבעה ברירת מחדל, ולכן כל
-- פונקציה שנוצרה אחריה חזרה להיות ניתנת להרצה ע"י anon. כאן נסגר גם העתיד.
alter default privileges in schema app     revoke execute on functions from public;
alter default privileges in schema finance revoke execute on functions from public;
alter default privileges in schema audit   revoke execute on functions from public;

-- ברירת המחדל הגורפת על טבלאות עתידיות (0008:37, 0009:8) פתחה כל טבלה חדשה
-- לכל משתמש מחובר עוד לפני שנקבעה לה RLS. מבטלים; מעניקים במפורש פר טבלה.
alter default privileges in schema app     revoke select, insert, update, delete on tables from authenticated;
alter default privileges in schema finance revoke select, insert, update, delete on tables from authenticated;

revoke execute on all functions in schema app     from public, anon;
revoke execute on all functions in schema finance from public, anon;
grant  execute on all functions in schema app     to authenticated, service_role;
grant  execute on all functions in schema finance to authenticated, service_role;

-- ארבע פונקציות ה-token הציבוריות בלבד ל-anon.
grant execute on function app.form_open(text)          to anon;
grant execute on function app.form_save(text, jsonb)   to anon;
grant execute on function app.form_submit(text, jsonb) to anon;
grant execute on function app.site_apply_form()        to anon;

-- C1: אין דרך לקרוא ל-link_employee מהרשת.
revoke execute on function app.link_employee(text, text, app.user_role) from public, anon, authenticated;
grant  execute on function app.unlink_candidate_user(uuid) to authenticated;

-- ============================================================================
-- 7. הסתרת שדות כספיים ממגייס (H10)
-- ============================================================================
-- הרשאות עמודתיות אינן יכולות להבחין בין מגייס למנהלת (שניהם authenticated),
-- לכן הטבלה יורדת מתחת לקרקע ובמקומה תצוגה: המנהלת רואה הכול, המגייס רואה
-- את ההשמות שלו בלבד וללא שכר/אחוז/עמלה. שמות העמודות והסדר נשמרו, כך
-- ששאילתות team-app הקיימות (כולל select *) ממשיכות לעבוד.
do $$
begin
  if to_regclass('finance.placements_private') is null then
    alter table finance.placements rename to placements_private;
  end if;
end $$;

create or replace view finance.placements with (security_barrier = true) as
select p.id,
       p.application_id,
       p.company_id,
       p.recruiter_id,
       p.agreement_id,
       p.accepted_at,
       p.expected_start_date,
       p.verified_start_date,
       case when (select app.is_manager()) then p.agreed_salary end       as agreed_salary,
       p.commission_base,
       case when (select app.is_manager()) then p.commission_pct end      as commission_pct,
       case when (select app.is_manager()) then p.expected_commission end as expected_commission,
       p.currency,
       p.warranty_days,
       p.warranty_ends_on,
       p.status,
       p.approved_by,
       p.approved_at,
       p.ended_reason,
       p.created_by,
       p.created_at,
       p.updated_at
from finance.placements_private p
where (select app.is_manager())
   or p.recruiter_id = (select app.current_employee());

-- הטבלה עצמה נסגרת ללקוחות; כל כתיבה עוברת דרך פונקציות SECURITY DEFINER.
revoke all on finance.placements_private from authenticated, anon;
grant select on finance.placements to authenticated;
grant all    on finance.placements to service_role;
grant all    on finance.placements_private to service_role;

-- ============================================================================
-- 8. שלמות נתונים (M9) ואינדקסים (M13)
-- ============================================================================
create unique index if not exists employees_email_lower_uniq on app.employees (lower(email));

alter table finance.placements_private drop constraint if exists placements_commission_pct_chk;
alter table finance.placements_private add  constraint placements_commission_pct_chk
  check (commission_pct > 0 and commission_pct <= 1000);
alter table finance.placements_private drop constraint if exists placements_warranty_days_chk;
alter table finance.placements_private add  constraint placements_warranty_days_chk
  check (warranty_days >= 0);

-- interviews.status היה טקסט חופשי; מצמצמים לערכים החוקיים בלבד.
alter table app.interviews drop constraint if exists interviews_status_chk;
alter table app.interviews add  constraint interviews_status_chk
  check (status in ('scheduled','done','cancelled','no_show'));

-- settings/stage_exposure: חותמת זמן ומי עדכן, אוטומטית.
create or replace function app.touch_settings()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then new.updated_by := auth.uid(); end if;
  return new;
end $$;
drop trigger if exists touch_settings on app.settings;
create trigger touch_settings before update on app.settings
  for each row execute function app.touch_settings();

create or replace function app.touch_stage_exposure()
returns trigger
language plpgsql security definer set search_path = app, auth, public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(app.current_employee(), new.updated_by);
  return new;
end $$;
drop trigger if exists touch_stage_exposure on app.stage_exposure;
create trigger touch_stage_exposure before update on app.stage_exposure
  for each row execute function app.touch_stage_exposure();

-- עמודות מפתח זר ללא אינדקס — הכבדות שבהן (M13).
create index if not exists bonus_lines_placement       on finance.bonus_calculation_lines (placement_id);
create index if not exists bonus_lines_clawback        on finance.bonus_calculation_lines (clawback_id);
create index if not exists placements_company          on finance.placements_private (company_id);
create index if not exists placements_agreement        on finance.placements_private (agreement_id);
create index if not exists placements_created_by       on finance.placements_private (created_by);
create index if not exists clawback_employee           on finance.clawback_proposals (employee_id);
create index if not exists clawback_calculation        on finance.clawback_proposals (calculation_id);
create index if not exists receipt_alloc_invoice       on finance.receipt_allocations (invoice_id);
create index if not exists bonus_calc_employee         on finance.bonus_calculations (employee_id);
create index if not exists conversations_recruiter     on app.conversations (recruiter_id);
create index if not exists tasks_parent                on app.tasks (parent_task_id);
create index if not exists tasks_recurrence            on app.tasks (recurrence_id);
create index if not exists tasks_automation_rule       on app.tasks (automation_rule_id);
create index if not exists deletion_requests_candidate on app.deletion_requests (candidate_id);
create index if not exists document_analyses_document  on app.document_analyses (document_id);
create index if not exists saved_jobs_publication      on app.saved_jobs (publication_id);
create index if not exists employees_manager           on app.employees (manager_id);
create index if not exists teams_lead                  on app.teams (lead_employee_id);
create index if not exists documents_uploaded_by       on app.documents (uploaded_by);
create index if not exists agreements_created_by       on app.agreements (created_by);
create index if not exists client_submissions_document on app.client_submissions (document_id);
create index if not exists client_submissions_contact  on app.client_submissions (contact_id);
create index if not exists conv_messages_document      on app.conversation_messages (document_id);

-- ============================================================================
-- 9. נרמול טלפון (L5)
-- ============================================================================
-- "0" הפך עד היום ל-"+972" ונשמר כמפתח כפילות. מהיום מוחזר null לכל מה
-- שאינו מספר ישראלי תקין (קווי 8 ספרות / נייד 9 ספרות אחרי הקידומת),
-- ומספר בינלאומי מפורש (+ ואחריו 8–15 ספרות) עובר כמות שהוא.
create or replace function app.normalize_phone(raw text)
returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(raw, ''), '[^0-9+]', '', 'g') as v),
  n as (
    select case
      when (select v from d) = ''         then null
      when (select v from d) like '+972%' then '+972' || regexp_replace(substr((select v from d), 5), '^0', '')
      when (select v from d) like '972%'  then '+972' || regexp_replace(substr((select v from d), 4), '^0', '')
      when (select v from d) like '0%'    then '+972' || substr((select v from d), 2)
      else (select v from d)
    end as v
  )
  select case
    when (select v from n) is null                       then null
    when (select v from n) ~ '^\+972[2-9][0-9]{7,8}$'    then (select v from n)
    when (select v from n) ~ '^\+(?!972)[1-9][0-9]{7,14}$' then (select v from n)
    else null
  end
$$;

-- ============================================================================
-- 10. אחסון (M8)
-- ============================================================================
do $$
begin
  if to_regclass('storage.objects') is not null then
    -- מסמכי מועמדים: צוות קורא רק מועמדים שבהיקף שלו, ולא את כל המאגר.
    drop policy if exists staff_reads_docs on storage.objects;
    create policy staff_reads_docs on storage.objects for select to authenticated
      using (bucket_id = 'candidate-docs' and (select app.is_staff())
             and exists (select 1 from app.candidates c
                          where c.id::text = (storage.foldername(name))[1]
                            and app.owner_in_scope(
                                  (select app.effective_scope('candidates','view')),
                                  (select app.current_employee()), (select app.my_team()),
                                  c.owner_employee_id)));

    -- מגייס יכול להעלות קו"ח למועמד שבהיקף שלו (עד היום לא היה מסלול כזה).
    drop policy if exists staff_writes_docs on storage.objects;
    create policy staff_writes_docs on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs' and (select app.is_staff())
             and exists (select 1 from app.candidates c
                          where c.id::text = (storage.foldername(name))[1]
                            and app.owner_in_scope(
                                  (select app.effective_scope('candidates','edit')),
                                  (select app.current_employee()), (select app.my_team()),
                                  c.owner_employee_id)));

    -- מחיקת קובץ של מועמד: המועמד עצמו (החלפת גרסה) או מנהלת.
    drop policy if exists candidate_deletes_own on storage.objects;
    create policy candidate_deletes_own on storage.objects for delete to authenticated
      using (bucket_id = 'candidate-docs'
             and ((storage.foldername(name))[1] = (select app.current_candidate())::text
                  or (select app.is_manager())));

    -- form-uploads: עד היום לא הייתה לאיש מדיניות insert, ולכן כל העלאה נכשלה.
    drop policy if exists form_uploads_staff_write on storage.objects;
    create policy form_uploads_staff_write on storage.objects for insert to authenticated
      with check (bucket_id = 'form-uploads' and ((select app.is_staff()) or (select app.current_candidate()) is not null));
    drop policy if exists form_uploads_mgr_delete on storage.objects;
    create policy form_uploads_mgr_delete on storage.objects for delete to authenticated
      using (bucket_id = 'form-uploads' and (select app.is_manager()));
  end if;
end $$;

-- ============================================================================
-- 11. מה נאכף מהיום במסד — ומה עדיין לא (C3)
-- ============================================================================
-- נאכף במסד:
--   · רק עובד פעיל ומזוהה ניגש לסכמות app/finance, ורק דרך RLS.
--   · תפקיד, סטטוס העסקה וחשבון המשתמש של עובד ניתנים לשינוי בידי מנהלת בלבד,
--     ותפקיד מנהל על בידי מנהל על בלבד (טריגר, חל גם על PostgREST).
--   · הגדרות, מטריצת ההרשאות, הסכמים, חשיפת שלבים, אוטומציות, צוותים ופרסומים:
--     קריאה לצוות, כתיבה למנהלת.
--   · מחיקה פיזית: מנהלת בלבד, למעט שורות תפעוליות; מחיקת מועמד מבוקרת דרך
--     app.anonymize_candidate (0023).
--   · היקף שלי/צוות/הכל על מועמדים, משרות ומועמדויות — נקרא ממטריצת ההרשאות
--     בזמן אמת דרך app.effective_scope, כולל שלילה פר משתמש ותוקף.
--   · שדות כספיים בהשמה מוסתרים ממי שאינו מנהלת (תצוגה במקום טבלה).
--   · כל שינוי בכרטיס עובד, בהגדרות, בהרשאות, בהסכמים ובחשיפת השלבים נרשם
--     ב-audit.events, שהוא append-only גם למי שמחובר ישירות למסד.
-- עדיין לא נאכף במסד (דורש שכבת API, SPEC:133):
--   · היקפים במודולים חיובים/התחשבנות/דוחות/ייבוא/אתר — שם ההפרדה היא עדיין
--     מנהלת מול מגייס בלבד.
--   · הסתרת שדות רגישים ברזולוציית שדה מעבר לשדות ההשמה.
--   · כלל "אי אפשר להעניק יותר ממה שיש למעניק" (אפיון, כלל 3) — נבדק בממשק בלבד.
--   · אימות דו-שלבי (SPEC:129) — הדגל קיים, האכיפה אינה במסד.

-- === 0023_business_rules_fixes.sql ===
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

-- === 0024_custom_fields_more_entities.sql ===
-- הרחבת מנוע השדות המותאמים לשלושה סוגי ישות נוספים: עובד/מגייס, משימה והשמה.
-- מנהל-על מוסיף ועורך את השדות מתוך הטופס עצמו (כפתור "עריכת שדות"), בלי קוד.
-- הערכים יושבים באובייקט custom של כל ישות, כמו בסוגים הקיימים (0018).

-- 1) הרחבת רשימת הסוגים המותרים ב-custom_fields.
alter table app.custom_fields drop constraint if exists custom_fields_entity_type_check;
alter table app.custom_fields add  constraint custom_fields_entity_type_check
  check (entity_type in ('candidate','job','company','application','employee','task','placement'));

-- 2) עמודת הערכים על הישויות הנכתבות ישירות (RLS קיים מתיר את הכתיבה).
alter table app.tasks     add column if not exists custom jsonb not null default '{}'::jsonb;
alter table app.employees add column if not exists custom jsonb not null default '{}'::jsonb;

-- 3) השמה: הטבלה פרטית (service_role בלבד) ומוצגת דרך view. מוסיפים עמודה,
-- חושפים אותה ב-view, וכותבים אליה דרך פונקציית SECURITY DEFINER בלבד.
alter table finance.placements_private add column if not exists custom jsonb not null default '{}'::jsonb;

create or replace view finance.placements with (security_barrier = true) as
select p.id,
       p.application_id,
       p.company_id,
       p.recruiter_id,
       p.agreement_id,
       p.accepted_at,
       p.expected_start_date,
       p.verified_start_date,
       case when (select app.is_manager()) then p.agreed_salary end       as agreed_salary,
       p.commission_base,
       case when (select app.is_manager()) then p.commission_pct end      as commission_pct,
       case when (select app.is_manager()) then p.expected_commission end as expected_commission,
       p.currency,
       p.warranty_days,
       p.warranty_ends_on,
       p.status,
       p.approved_by,
       p.approved_at,
       p.ended_reason,
       p.created_by,
       p.created_at,
       p.updated_at,
       p.custom
from finance.placements_private p
where (select app.is_manager())
   or p.recruiter_id = (select app.current_employee());

grant select on finance.placements to authenticated;

-- שמירת שדות מותאמים להשמה. גישה זהה לראות ההשמה ב-view: מנהלת, או המגייס
-- שההשמה שלו. שדות כספיים אינם נגעים כאן — רק custom.
create or replace function finance.set_placement_custom(p_id uuid, p_custom jsonb)
returns void
language plpgsql security definer set search_path = finance, app, public as $$
begin
  if p_custom is null or jsonb_typeof(p_custom) <> 'object' then
    raise exception 'custom חייב להיות אובייקט JSON';
  end if;
  update finance.placements_private p
     set custom = p_custom, updated_at = now()
   where p.id = p_id
     and ((select app.is_manager()) or p.recruiter_id = (select app.current_employee()));
  if not found then
    raise exception 'ההשמה לא נמצאה או שאין הרשאה' using errcode = 'P0002';
  end if;
end $$;

revoke all     on function finance.set_placement_custom(uuid, jsonb) from public, anon;
grant  execute on function finance.set_placement_custom(uuid, jsonb) to authenticated;

-- === 0025_form_layouts.sql ===
-- בנאי טפסים: מנהל-על עורך את מבנה הטופס מתוך המסך — סדר השדות, הסתרה,
-- שינוי תווית, והוספת/מחיקת שדות. ההגדרה נשמרת כאן לכל סוג ישות; השדות
-- המובנים ("company_id","title"...) מיוצגים כ-slots עם binding לעמודה, ושדות
-- חדשים נשמרים כ-slots מסוג custom שערכיהם יושבים ב-custom (0018/0024).
--
-- אין שורה = ברירת המחדל שבקוד (סדר השדות המקורי). נוצרת שורה רק כשמנהל-על
-- עורך. שדה חובה במסד ללא ברירת מחדל (company_id, title) נעול: אפשר להזיז
-- ולשנות תווית, אי אפשר להסתיר/למחוק — אחרת יצירת הרשומה נשברת.

create table if not exists app.form_layouts (
  entity_type text primary key
    check (entity_type in ('candidate','job','company','application','employee','task','placement')),
  slots       jsonb not null default '[]'::jsonb,   -- [{ref,label?,hidden?,width?}] לפי סדר
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app.employees(id)
);

alter table app.form_layouts enable row level security;

-- קריאה: כל הצוות (כדי לרנדר את הטופס). כתיבה: מנהל-על בלבד.
drop policy if exists form_layouts_read  on app.form_layouts;
create policy form_layouts_read on app.form_layouts for select to authenticated
  using (app.is_staff());
drop policy if exists form_layouts_write on app.form_layouts;
create policy form_layouts_write on app.form_layouts for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

grant select, insert, update, delete on app.form_layouts to authenticated;

create trigger form_layouts_touch before update on app.form_layouts
  for each row execute function app.touch_updated_at();

-- === 0026_site_rebuild_hook.sql ===
-- אוטומציה: שינוי שמשפיע על המשרות הציבוריות מפעיל בנייה מחדש של האתר הסטטי.
-- האתר הציבורי צורב את המשרות בזמן בנייה, ולכן פרסום/הסרת פרסום/עריכת טקסט
-- ציבורי (job_publications) או סגירת משרה (jobs.stage) לא מופיעים באתר עד
-- rebuild. טריגר קורא ל-Cloudflare Deploy Hook דרך pg_net; כתובת ה-hook סודית
-- ונשמרת ב-app.site_config (נעולה), ומוגדרת פעם אחת ב-SQL Editor.

-- pg_net מותקן ב-Supabase. בסביבת בדיקות (Postgres ואניל) הוא אינו זמין — נבלע
-- והטריגר יהפוך ל-no-op עד שיותקן.
do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net לא זמין — טריגר הבנייה יהיה no-op עד להתקנתו (צפוי בסביבת בדיקות)';
end $$;

-- טבלת קונפיגורציה נעולה לסודות אינטגרציה. אין policies ל-authenticated/anon,
-- ולכן היא נגישה רק ל-service_role ולפונקציות SECURITY DEFINER.
create table if not exists app.site_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app.site_config enable row level security;
revoke all on app.site_config from authenticated, anon;

drop trigger if exists site_config_touch on app.site_config;
create trigger site_config_touch before update on app.site_config
  for each row execute function app.touch_updated_at();

-- הפעלת ה-Deploy Hook. no-op בבטחה כשאין כתובת מוגדרת או כש-pg_net לא מותקן.
create or replace function app.notify_site_rebuild()
returns trigger
language plpgsql security definer set search_path = app, public as $$
declare v_url text;
begin
  select value into v_url from app.site_config where key = 'deploy_hook_url';
  if v_url is null or btrim(v_url) = '' then return null; end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) then return null; end if;
  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('trigger', tg_table_name, 'at', now())
  );
  return null;
end $$;

-- שינוי בפרסומים — ברמת statement (למניעת ריבוי קריאות בפעולה מרובת-שורות).
drop trigger if exists job_publications_rebuild on app.job_publications;
create trigger job_publications_rebuild
  after insert or update or delete on app.job_publications
  for each statement execute function app.notify_site_rebuild();

-- סגירת/פתיחת משרה משנה את נראותה הציבורית (published_jobs מסנן לפי stage).
drop trigger if exists jobs_stage_rebuild on app.jobs;
create trigger jobs_stage_rebuild
  after update of stage on app.jobs
  for each row when (old.stage is distinct from new.stage)
  execute function app.notify_site_rebuild();

-- === 0027_permission_engine.sql ===
-- 0027 · הוספת מודול "forms" ל-enum ההרשאות — בלבד.
--
-- למה קובץ נפרד: Postgres אוסר שימוש בערך enum חדש באותה טרנזקציה שהוסיפה
-- אותו (SQLSTATE 55P04, "New enum values must be committed before they can be
-- used"). ה-SQL Editor של Supabase עוטף כל סקריפט בטרנזקציה אחת, ולכן הוספת
-- הערך והשימוש בו חייבים להיות בשני קבצים/הרצות נפרדות. כל מה שמשתמש ב-'forms'
-- (הזרעה, פונקציות, view, מדיניות) נמצא ב-0028, שירוץ אחרי ש-0027 עשה commit.
--
-- forms = "בניית טפסים" (מבנה/layouts/custom_fields), נבדל מ"שליחת טופס"
-- שנעשית מהכרטיס הרלוונטי ונשלטת ע"י candidate_messages.

alter type app.perm_module add value if not exists 'forms';

-- === 0028_permission_forms_wiring.sql ===
-- 0028 · חיווט מודול forms + חשיפת ההרשאות ל-UI.
-- רץ אחרי ש-0027 (הוספת הערך 'forms' ל-enum) עשה commit — ראו ההסבר ב-0027.
--
-- המנוע (app.effective_scope / app.owner_in_scope) והמדיניות מודעת-ה-scope
-- לטבלאות הליבה קיימים מ-0022. כאן:
--   1. ברירות מחדל למודול forms.
--   2. app.has_permission + view app.my_permissions (לקריאה מה-UI).
--   3. חיווט טבלאות בניית-הטפסים (form_templates/form_layouts/custom_fields)
--      למודול forms, במקום הגייטים הקשיחים הלא-אחידים שהיו.

-- ---------- ברירות מחדל ----------
-- מגייס — אין בנייה; מנהלת/מנהל על — בנייה מלאה. (בפועל effective_scope מחזיר
-- 'all' למנהלת/מנהל-על על הכול; שורות אלה כדי שמסך המטריצה יציג את התא, ושאפשר
-- יהיה להעניק בנייה למגייס דרך פרופיל/override.)
insert into app.permission_defaults (role, module, action, scope)
select r, 'forms'::app.perm_module, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_action)) a
on conflict (role, module, action) do nothing;

update app.permission_defaults set scope = 'all'
 where module = 'forms'
   and role in ('manager','superadmin')
   and action in ('view','create','edit','delete');

-- ---------- קיצור בוליאני מעל המנוע הקיים ----------
create or replace function app.has_permission(p_module text, p_action text)
returns boolean
language sql stable security definer set search_path = app, auth, public as $$
  select app.effective_scope(p_module, p_action) <> 'none'
$$;
grant execute on function app.has_permission(text, text) to authenticated;

-- ---------- ה-view לקריאת ההרשאות של המשתמש הנוכחי ----------
-- מסך הצוות מושך את זה פעם אחת ומסתיר/חוסם פעולות לא-מורשות. מחזיר רק
-- שילובים עם היקף אפקטיבי כלשהו (> none). security_invoker כדי שהחישוב
-- יתייחס למשתמש הקורא (הפונקציות שבתוכו הן SECURITY DEFINER בכל מקרה).
create or replace view app.my_permissions
with (security_invoker = true) as
  select m::text as module, a::text as action, app.effective_scope(m::text, a::text) as scope
  from unnest(enum_range(null::app.perm_module)) m
  cross join unnest(enum_range(null::app.perm_action)) a
  where app.effective_scope(m::text, a::text) <> 'none';
grant select on app.my_permissions to authenticated;

-- ---------- חיווט טבלאות בניית-הטפסים למודול forms ----------
-- קריאה נשארת לכל הצוות; כתיבה (בנייה) נשלטת ע"י המטריצה במקום גייט קשיח.
-- אלו טבלאות תצורה ללא בעלות פר-שורה → די בבדיקת היקף <> none.
-- form_instances/form_events (שליחת טופס) נשארים כפי שהם — שליחה דרך הכרטיס.

-- form_templates: היה staff מלא (גם מגייס יכול היה) → עכשיו בנייה לפי forms.
drop policy if exists form_templates_staff on app.form_templates;
drop policy if exists form_templates_read on app.form_templates;
create policy form_templates_read on app.form_templates for select to authenticated
  using ((select app.is_staff()));
drop policy if exists form_templates_insert on app.form_templates;
create policy form_templates_insert on app.form_templates for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
drop policy if exists form_templates_update on app.form_templates;
create policy form_templates_update on app.form_templates for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
drop policy if exists form_templates_delete on app.form_templates;
create policy form_templates_delete on app.form_templates for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');

-- custom_fields: היה write=manager → עכשיו לפי forms.
drop policy if exists custom_fields_write on app.custom_fields;
drop policy if exists custom_fields_insert on app.custom_fields;
create policy custom_fields_insert on app.custom_fields for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
drop policy if exists custom_fields_update on app.custom_fields;
create policy custom_fields_update on app.custom_fields for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
drop policy if exists custom_fields_delete on app.custom_fields;
create policy custom_fields_delete on app.custom_fields for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');

-- form_layouts: היה write=superadmin → עכשיו לפי forms (מנהלת מקבלת גם היא).
drop policy if exists form_layouts_write on app.form_layouts;
drop policy if exists form_layouts_insert on app.form_layouts;
create policy form_layouts_insert on app.form_layouts for insert to authenticated
  with check ((select app.effective_scope('forms','create')) <> 'none');
drop policy if exists form_layouts_update on app.form_layouts;
create policy form_layouts_update on app.form_layouts for update to authenticated
  using ((select app.effective_scope('forms','edit')) <> 'none')
  with check ((select app.effective_scope('forms','edit')) <> 'none');
drop policy if exists form_layouts_delete on app.form_layouts;
create policy form_layouts_delete on app.form_layouts for delete to authenticated
  using ((select app.effective_scope('forms','delete')) <> 'none');

-- === 0029_cv_ai_analysis.sql ===
-- 0029 · הפעלת ניתוח קורות חיים ב-AI (Claude)
-- התשתית קיימת מ-0003: app.document_analyses (הצעות עד לאישור אדם) ו-app.ai_status.
-- כאן רק מוסיפים הגדרת מודל שניתנת לעריכה מהמערכת, ומרעננים תיאורים.
-- ההפעלה בפועל: הדבקת ANTHROPIC_API_KEY בסודות ה-Edge Function, פריסת הפונקציה
-- analyze-cv, והפעלת המתג ai.enabled מתוך הגדרות → AI. המפתח לעולם אינו בקוד/בדפדפן.

-- ai.model — המודל שבו analyze-cv משתמשת. ברירת מחדל: Sonnet 5 (איזון דיוק/עלות).
insert into app.settings (key, value, description) values
  ('ai.model', '"claude-sonnet-5"', 'מודל ה-AI לניתוח קורות חיים')
on conflict (key) do nothing;

-- ריענון תיאורים לבהירות בממשק ההגדרות.
update app.settings
   set description = 'ניתוח קורות חיים ב-AI פעיל/כבוי'
 where key = 'ai.enabled';
update app.settings
   set description = 'מכסת ניתוחים חודשית (0 = ללא הגבלה)'
 where key = 'ai.monthly_quota';

-- === 0030_staff_upload_candidate_docs.sql ===
-- 0030 · העלאת מסמכי מועמד על ידי הצוות
-- עד היום רק המועמד יכול היה להעלות לתיקייה של עצמו ב-candidate-docs
-- (candidate_writes_own מ-0011), ולכן למגייס לא הייתה דרך להעלות קו״ח מהמערכת
-- — למשל כשהקו״ח מההגשה הציבורית לא נקלט. כאן מוסיפים לצוות הרשאת העלאה
-- ומחיקה בדלי. service_role ממשיך לעקוף RLS; שאר המדיניות ללא שינוי.
-- הבלוק no-op בבטחה בסביבת בדיקות שבה אין schema של storage.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists staff_writes_docs on storage.objects;
    create policy staff_writes_docs on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs' and app.is_staff());

    -- מחיקה לצוות: מאפשרת ניקוי קובץ יתום בכשל רישום, והחלפת קו״ח.
    -- עקבי עם הרשאת המחיקה שכבר קיימת לצוות על טבלת documents (0022).
    drop policy if exists staff_deletes_docs on storage.objects;
    create policy staff_deletes_docs on storage.objects for delete to authenticated
      using (bucket_id = 'candidate-docs' and app.is_staff());
  end if;
end $$;

-- === 0031_ai_permission_enum.sql ===
-- 0031 · הוספת הערך 'ai_analysis' ל-app.perm_module.
-- במיגרציה נפרדת בכוונה: Postgres דורש שערך enum חדש יעבור commit לפני שאפשר
-- להשתמש בו (בדיוק כמו 0027 עבור 'forms'). את ברירות המחדל זורעים ב-0032.
alter type app.perm_module add value if not exists 'ai_analysis';

-- === 0032_ai_permission_defaults.sql ===
-- 0032 · הרשאת ניתוח קו״ח ב-AI (מודול ai_analysis).
-- הפעולה המשמעותית היא create = הרצת ניתוח. effective_scope מחזיר 'all'
-- למנהלת/מנהל-על על הכול; שורות אלה נזרעות כדי שהתא יוצג במטריצה ושאפשר יהיה
-- להעניק/לשלול למגייס. מגייס מקבל create='all' כברירת מחדל — שמירה על ההתנהגות
-- שהייתה (כל עובד פעיל יכול לנתח). מנהלת יכולה לצמצם דרך המטריצה/override.
-- הפונקציה analyze-cv אוכפת זאת בצד-שרת דרך app.has_permission('ai_analysis','create').

insert into app.permission_defaults (role, module, action, scope)
select r, 'ai_analysis'::app.perm_module, a, 'none'::app.perm_scope
from unnest(array['recruiter','manager','superadmin']::app.user_role[]) r
cross join unnest(enum_range(null::app.perm_action)) a
on conflict (role, module, action) do nothing;

update app.permission_defaults set scope = 'all'
 where module = 'ai_analysis' and role in ('manager','superadmin')
   and action in ('view','create');

update app.permission_defaults set scope = 'all'
 where module = 'ai_analysis' and role = 'recruiter' and action = 'create';

-- === 0033_cashflow_billing.sql ===
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
