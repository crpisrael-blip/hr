-- הפיכת טופס ההגשה באתר לניתן־עריכה מהמערכת, וזריעת תבניות טפסים מוכנות.
-- (1) דגל is_site_apply על תבנית — קובעת אילו שאלות נוספות מוצגות בטופס
--     ההגשה הציבורי, מעבר לשדות הבסיס (שם/טלפון/דוא״ל/קו״ח/הסכמה).
-- (2) עמודת answers על applications — לאחסון תשובות השאלות הנוספות.
-- (3) פונקציה ציבורית שמחזירה את שדות טופס ההגשה הפעיל (ללא התחברות).
-- (4) זריעת תבניות מוכנות לעריכה מיידית בבנאי.

-- ---------- (1) דגל טופס ההגשה באתר ----------
alter table app.form_templates add column if not exists is_site_apply boolean not null default false;
-- רק תבנית אחת יכולה לשמש כטופס ההגשה באתר בו־זמנית.
create unique index if not exists form_templates_site_apply_one
  on app.form_templates (is_site_apply) where is_site_apply;

-- ---------- (2) תשובות השאלות הנוספות בהגשה ----------
alter table app.applications add column if not exists answers jsonb not null default '{}'::jsonb;

-- ---------- (3) חשיפת שדות טופס ההגשה הפעיל (ציבורי) ----------
-- מחזיר רק את הגדרת השדות הציבורית — לעולם לא מיפוי/תיוק/מטא פנימי.
create or replace function app.site_apply_form()
returns jsonb language sql stable security definer set search_path = app, public as $$
  select coalesce(
    (select jsonb_build_object(
       'name', name, 'description', description,
       'fields', coalesce(definition->'fields', '[]'::jsonb))
     from app.form_templates
     where is_site_apply and status = 'active' limit 1),
    jsonb_build_object('fields', '[]'::jsonb));
$$;
grant execute on function app.site_apply_form() to anon, authenticated;

-- ---------- (4) תבניות מוכנות (idempotent — לפי שם) ----------
insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'קליטת עובד חדש',
  'טופס קליטה לעובד/מגייס חדש — פרטים אישיים, פרטי בנק ותחילת עבודה.',
  'staff', $json${
  "fields":[
    {"key":"h_personal","type":"heading","label":"פרטים אישיים","order":0},
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":1},
    {"key":"id_number","type":"text","label":"תעודת זהות","required":true,"order":2},
    {"key":"birth_date","type":"date","label":"תאריך לידה","order":3},
    {"key":"phone","type":"text","label":"טלפון","required":true,"order":4},
    {"key":"email","type":"text","label":"דוא״ל","required":true,"order":5},
    {"key":"address","type":"textarea","label":"כתובת מגורים","order":6},
    {"key":"h_bank","type":"heading","label":"פרטי חשבון בנק","order":7},
    {"key":"bank_name","type":"text","label":"בנק","order":8},
    {"key":"bank_branch","type":"text","label":"סניף","order":9},
    {"key":"bank_account","type":"text","label":"מספר חשבון","order":10},
    {"key":"h_start","type":"heading","label":"תחילת עבודה","order":11},
    {"key":"start_date","type":"date","label":"תאריך תחילת עבודה","order":12},
    {"key":"emergency_name","type":"text","label":"איש קשר לחירום","order":13},
    {"key":"emergency_phone","type":"text","label":"טלפון איש קשר לחירום","order":14},
    {"key":"signature","type":"signature","label":"חתימת העובד","required":true,"order":15}
  ]}$json$::jsonb,
  'employee', 'קליטה', 'active'
where not exists (select 1 from app.form_templates where name = 'קליטת עובד חדש');

insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'הצהרת בריאות',
  'הצהרת בריאות למועמד/עובד לפני תחילת עבודה.',
  'candidate', $json${
  "fields":[
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":0},
    {"key":"id_number","type":"text","label":"תעודת זהות","required":true,"order":1},
    {"key":"health_ok","type":"boolean","label":"אני בריא/ה וכשיר/ה לעבודה","required":true,"order":2},
    {"key":"has_condition","type":"boolean","label":"קיימת מגבלה רפואית הרלוונטית לתפקיד","order":3},
    {"key":"condition_details","type":"textarea","label":"פירוט המגבלה","help":"למילוי רק אם קיימת מגבלה","show_if":{"field":"has_condition","equals":"כן"},"order":4},
    {"key":"declaration","type":"boolean","label":"ההצהרה נכונה ומדויקת","required":true,"order":5},
    {"key":"signature","type":"signature","label":"חתימה","required":true,"order":6}
  ]}$json$::jsonb,
  'employee', 'אישורים', 'active'
where not exists (select 1 from app.form_templates where name = 'הצהרת בריאות');

insert into app.form_templates (name, description, recipient_type, definition, field_map, filing_target, filing_category, status)
select 'אישור ועדכון פרטים אישיים',
  'המועמד מאשר ומעדכן את הפרטים שלו במערכת.',
  'candidate', $json${
  "fields":[
    {"key":"full_name","type":"text","label":"שם מלא","required":true,"order":0},
    {"key":"phone","type":"text","label":"טלפון","required":true,"order":1},
    {"key":"email","type":"text","label":"דוא״ל","order":2},
    {"key":"availability","type":"select","label":"זמינות לעבודה","options":[{"value":"מיידית","label":"מיידית"},{"value":"תוך חודש","label":"תוך חודש"},{"value":"גמיש","label":"גמיש"}],"order":3},
    {"key":"confirm","type":"boolean","label":"הפרטים נכונים ומעודכנים","required":true,"order":4}
  ]}$json$::jsonb,
  $json$[
    {"field_key":"full_name","table":"candidates","column":"full_name","mode":"approve"},
    {"field_key":"phone","table":"candidates","column":"phone_raw","mode":"approve"},
    {"field_key":"email","table":"candidates","column":"email","mode":"approve"},
    {"field_key":"availability","table":"candidates","column":"availability","mode":"approve"}
  ]$json$::jsonb,
  'candidate', 'מסמכי מועמד', 'active'
where not exists (select 1 from app.form_templates where name = 'אישור ועדכון פרטים אישיים');

-- תבנית לדוגמה לטופס ההגשה באתר. is_site_apply נשאר כבוי — המנהלת מדליקה
-- אותה בבנאי כשתהיה מוכנה, כדי שלא לשנות את התנהגות האתר הקיים באופן אוטומטי.
insert into app.form_templates (name, description, recipient_type, definition, filing_target, filing_category, status)
select 'שאלות נוספות להגשת מועמדות (אתר)',
  'שאלות שמוצגות בטופס ההגשה הציבורי מתחת לשדות הבסיס. הדליקו "טופס ההגשה באתר" כדי להפעיל.',
  'candidate', $json${
  "fields":[
    {"key":"city","type":"text","label":"עיר מגורים","order":0},
    {"key":"availability","type":"select","label":"זמינות לעבודה","options":[{"value":"מיידית","label":"מיידית"},{"value":"תוך חודש","label":"תוך חודש"},{"value":"גמיש","label":"גמיש"}],"order":1},
    {"key":"source","type":"select","label":"איך הגעת אלינו?","options":[{"value":"חיפוש בגוגל","label":"חיפוש בגוגל"},{"value":"רשתות חברתיות","label":"רשתות חברתיות"},{"value":"המלצה","label":"המלצה"},{"value":"אחר","label":"אחר"}],"order":2},
    {"key":"linkedin","type":"text","label":"קישור לפרופיל LinkedIn","order":3}
  ]}$json$::jsonb,
  'application', 'גיוס', 'active'
where not exists (select 1 from app.form_templates where name = 'שאלות נוספות להגשת מועמדות (אתר)');
