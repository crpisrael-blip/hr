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
