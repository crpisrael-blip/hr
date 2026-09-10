-- HR schema (0001..0016 merged for Supabase SQL Editor)

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
