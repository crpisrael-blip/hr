-- 0029 · הפעלת ניתוח קורות חיים ב-AI (Claude)
-- התשתית קיימת מ-0003: app.document_analyses (הצעות עד לאישור אדם) ו-app.ai_status.
-- כאן רק מוסיפים הגדרת מודל שניתנת לעריכה מהמערכת, ומרעננים תיאורים.
-- ההפעלה בפועל: הדבקת ANTHROPIC_API_KEY בסודות ה-Edge Function, פריסת הפונקציה
-- analyze-cv, והפעלת המתג ai.enabled מתוך הגדרות → AI. המפתח לעולם אינו בקוד/בדפדפן.

-- ai.model — המודל שבו analyze-cv משתמשת. ברירת מחדל: Sonnet 5 (איזון דיוק/עלות).
insert into app.settings (key, value, description) values
  ('ai.model', '"claude-sonnet-5"', 'מודל ה-AI לניתוח קורות חיים')
on conflict (key) do nothing;

-- ריענון תיאורים לבהירות בממשק ההגדרות.
update app.settings
   set description = 'ניתוח קורות חיים ב-AI פעיל/כבוי'
 where key = 'ai.enabled';
update app.settings
   set description = 'מכסת ניתוחים חודשית (0 = ללא הגבלה)'
 where key = 'ai.monthly_quota';
