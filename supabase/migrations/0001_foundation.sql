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
