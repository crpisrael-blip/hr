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
