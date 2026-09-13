## מה השתנה

<!-- תיאור קצר בעברית. מה, ולמה — לא איך. -->

## סוג השינוי

- [ ] `feat` — יכולת חדשה
- [ ] `fix` — תיקון באג
- [ ] `docs` — תיעוד בלבד
- [ ] `refactor` — שינוי מבנה בלי שינוי התנהגות
- [ ] `test` — בדיקות
- [ ] `chore` / `ci` — תחזוקה, תלויות, תשתית

## מה נבדק

- [ ] `npm run db:test` עבר (אם נגעתי ב-`supabase/migrations/` או ב-`supabase/tests/`)
- [ ] `npm run db:schema` הורץ והשינוי ב-`supabase/schema.sql` נכלל בקומיט
- [ ] `npm run build:public` / `build:team` / `build:candidate` — הרלוונטיים עברו
- [ ] `npm run check --workspace=@hr/public-site` (אם נגעתי באתר הציבורי)

## השפעה על פריסה

- [ ] אין
- [ ] דורש משתנה סביבה / סוד חדש — עודכנו `.env.example`, `docs/DEPLOY.md` ו-`docs/CONFIG_CHECKLIST.md`
- [ ] דורש הרצת מיגרציה ב-Supabase SQL Editor
- [ ] דורש פריסה מחדש של פונקציית קצה (`apply` / `invite-employee`)

## תיעוד

- [ ] `docs/SPEC.md` ו-`docs/IMPLEMENTATION_STATUS.md` משקפים את המצב אחרי השינוי
- [ ] `CHANGELOG.md` עודכן (אם זה שינוי שמשתמש קצה מרגיש)

## סודות

- [ ] אין מפתח, סיסמה או `DATABASE_URL` בדיף. משתני `VITE_*` מכילים anon בלבד, לעולם לא service-role.
