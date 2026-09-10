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
