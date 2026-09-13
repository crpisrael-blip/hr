-- בנאי טפסים: מנהל-על עורך את מבנה הטופס מתוך המסך — סדר השדות, הסתרה,
-- שינוי תווית, והוספת/מחיקת שדות. ההגדרה נשמרת כאן לכל סוג ישות; השדות
-- המובנים ("company_id","title"...) מיוצגים כ-slots עם binding לעמודה, ושדות
-- חדשים נשמרים כ-slots מסוג custom שערכיהם יושבים ב-custom (0018/0024).
--
-- אין שורה = ברירת המחדל שבקוד (סדר השדות המקורי). נוצרת שורה רק כשמנהל-על
-- עורך. שדה חובה במסד ללא ברירת מחדל (company_id, title) נעול: אפשר להזיז
-- ולשנות תווית, אי אפשר להסתיר/למחוק — אחרת יצירת הרשומה נשברת.

create table if not exists app.form_layouts (
  entity_type text primary key
    check (entity_type in ('candidate','job','company','application','employee','task','placement')),
  slots       jsonb not null default '[]'::jsonb,   -- [{ref,label?,hidden?,width?}] לפי סדר
  updated_at  timestamptz not null default now(),
  updated_by  uuid references app.employees(id)
);

alter table app.form_layouts enable row level security;

-- קריאה: כל הצוות (כדי לרנדר את הטופס). כתיבה: מנהל-על בלבד.
drop policy if exists form_layouts_read  on app.form_layouts;
create policy form_layouts_read on app.form_layouts for select to authenticated
  using (app.is_staff());
drop policy if exists form_layouts_write on app.form_layouts;
create policy form_layouts_write on app.form_layouts for all to authenticated
  using (app.is_superadmin()) with check (app.is_superadmin());

grant select, insert, update, delete on app.form_layouts to authenticated;

create trigger form_layouts_touch before update on app.form_layouts
  for each row execute function app.touch_updated_at();
