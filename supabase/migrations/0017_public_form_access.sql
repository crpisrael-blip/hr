-- תיקון גישת טפסים ציבוריים (מילוי לפי token ללא התחברות).
-- הבעיה: מבקר לא מחובר הוא בתפקיד anon, ול-anon לא הייתה הרשאת USAGE על
-- סכמת app — לכן קריאת app.form_open נכשלה ב-"permission denied for schema app",
-- והמסך הציג "הטופס לא נמצא".
--
-- אבטחה: ברירת המחדל של Postgres מעניקה EXECUTE ל-PUBLIC על כל פונקציה. בסכמת
-- app יש פונקציות SECURITY DEFINER רגישות (מנוע בונוסים, כספים, אזור המועמד).
-- עד היום anon נחסם רק בכך שלא הייתה לו גישה לסכמה. לכן, לפני שמעניקים ל-anon
-- USAGE על הסכמה, מבטלים את EXECUTE הגורף מ-PUBLIC ומעניקים אותו מחדש במפורש
-- ל-authenticated (שימור המצב הקיים בדיוק), ורק את ארבע פונקציות ה-token
-- הציבוריות מעניקים ל-anon.

-- 1) ביטול ה-EXECUTE הגורף שמגיע מ-PUBLIC (משפיע גם על anon).
revoke execute on all functions in schema app from public;

-- 2) שימור ההתנהגות הקיימת: authenticated ו-service_role ממשיכים להריץ הכול.
grant execute on all functions in schema app to authenticated;
grant execute on all functions in schema app to service_role;

-- 3) גישת קריאה לסכמה ל-anon (בלי הרשאות טבלה — RLS ממשיך לחסום, ואין ל-anon
--    שום GRANT על טבלאות app).
grant usage on schema app to anon;

-- 4) הענקת EXECUTE ל-anon רק לפונקציות ה-token הציבוריות והבטוחות.
grant execute on function app.form_open(text)          to anon;
grant execute on function app.form_save(text, jsonb)   to anon;
grant execute on function app.form_submit(text, jsonb) to anon;
grant execute on function app.site_apply_form()        to anon;
