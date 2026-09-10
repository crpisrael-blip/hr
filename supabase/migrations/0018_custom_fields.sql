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
