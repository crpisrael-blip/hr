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
