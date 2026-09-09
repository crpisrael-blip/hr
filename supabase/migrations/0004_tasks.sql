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
