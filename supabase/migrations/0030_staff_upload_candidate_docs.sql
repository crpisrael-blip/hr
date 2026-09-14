-- 0030 · העלאת מסמכי מועמד על ידי הצוות
-- עד היום רק המועמד יכול היה להעלות לתיקייה של עצמו ב-candidate-docs
-- (candidate_writes_own מ-0011), ולכן למגייס לא הייתה דרך להעלות קו״ח מהמערכת
-- — למשל כשהקו״ח מההגשה הציבורית לא נקלט. כאן מוסיפים לצוות הרשאת העלאה
-- ומחיקה בדלי. service_role ממשיך לעקוף RLS; שאר המדיניות ללא שינוי.
-- הבלוק no-op בבטחה בסביבת בדיקות שבה אין schema של storage.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists staff_writes_docs on storage.objects;
    create policy staff_writes_docs on storage.objects for insert to authenticated
      with check (bucket_id = 'candidate-docs' and app.is_staff());

    -- מחיקה לצוות: מאפשרת ניקוי קובץ יתום בכשל רישום, והחלפת קו״ח.
    -- עקבי עם הרשאת המחיקה שכבר קיימת לצוות על טבלת documents (0022).
    drop policy if exists staff_deletes_docs on storage.objects;
    create policy staff_deletes_docs on storage.objects for delete to authenticated
      using (bucket_id = 'candidate-docs' and app.is_staff());
  end if;
end $$;
