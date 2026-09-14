-- 0031 · הוספת הערך 'ai_analysis' ל-app.perm_module.
-- במיגרציה נפרדת בכוונה: Postgres דורש שערך enum חדש יעבור commit לפני שאפשר
-- להשתמש בו (בדיוק כמו 0027 עבור 'forms'). את ברירות המחדל זורעים ב-0032.
alter type app.perm_module add value if not exists 'ai_analysis';
