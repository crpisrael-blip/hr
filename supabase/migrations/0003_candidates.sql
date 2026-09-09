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
