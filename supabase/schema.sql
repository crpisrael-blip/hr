-- ============================================================
-- HR — סכימה מלאה להרצה חד-פעמית ב-Supabase SQL Editor
-- מאוחד מתוך supabase/migrations/0001..0007. מקור האמת נשאר הקבצים הנפרדים.
-- להריץ פעם אחת על פרויקט חדש. הרצה חוזרת תשגה על create type קיים.
-- ============================================================

-- ============================================================
-- 0001_foundation.sql
-- ============================================================
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

-- ============================================================
-- 0002_crm.sql
-- ============================================================
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

-- ============================================================
-- 0003_candidates.sql
-- ============================================================
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

-- ============================================================
-- 0004_tasks.sql
-- ============================================================
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

-- ============================================================
-- 0005_finance.sql
-- ============================================================
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

-- ============================================================
-- 0006_seed_settings.sql
-- ============================================================
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

-- ============================================================
-- 0007_business_rules.sql
-- ============================================================
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

