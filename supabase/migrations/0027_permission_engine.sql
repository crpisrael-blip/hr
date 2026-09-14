-- 0027 · הוספת מודול "forms" ל-enum ההרשאות — בלבד.
--
-- למה קובץ נפרד: Postgres אוסר שימוש בערך enum חדש באותה טרנזקציה שהוסיפה
-- אותו (SQLSTATE 55P04, "New enum values must be committed before they can be
-- used"). ה-SQL Editor של Supabase עוטף כל סקריפט בטרנזקציה אחת, ולכן הוספת
-- הערך והשימוש בו חייבים להיות בשני קבצים/הרצות נפרדות. כל מה שמשתמש ב-'forms'
-- (הזרעה, פונקציות, view, מדיניות) נמצא ב-0028, שירוץ אחרי ש-0027 עשה commit.
--
-- forms = "בניית טפסים" (מבנה/layouts/custom_fields), נבדל מ"שליחת טופס"
-- שנעשית מהכרטיס הרלוונטי ונשלטת ע"י candidate_messages.

alter type app.perm_module add value if not exists 'forms';
