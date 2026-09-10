# מדריך הפעלה (Runbook)

שלושה רכיבים עצמאיים, כל אחד נפרס לחוד. סודות לעולם לא בקוד — רק במשתני
הסביבה של Cloudflare / Supabase.

| רכיב | תיקיית שורש | Cloudflare project | דומיין |
|------|------------|--------------------|--------|
| אתר ציבורי | `apps/public-site` | `hr-public-site` | `hr.ort-tech.co.il` |
| ממשק צוות | `apps/team-app` | `hr-team-app` | `hr-app.ort-tech.co.il` |
| אזור אישי (my.hr) | `apps/candidate-app` | `hr-candidate-app` | `my.hr.ort-tech.co.il` |

בכל פרויקט Cloudflare: משתנה **Build** בשם `NODE_VERSION` בערך `22`.

---

## 1. מסד הנתונים (Supabase)

פרויקט `jsxkwosjtjdypwedzxwx` (eu-central-1).

1. **הרצת הסכמה.** ב-SQL Editor להריץ את `supabase/schema.sql` המאוחד
   (או את המיגרציות לפי הסדר). לאחר שינוי במיגרציות מריצים
   `npm run db:schema` כדי לבנות מחדש את הקובץ המאוחד.
2. **קישור המנהלת** (פעם אחת, אחרי יצירת המשתמש ב-Authentication):
   ```sql
   select app.link_employee('EMAIL', 'שם מלא', 'manager');
   ```
3. **אחסון מסמכים.** המיגרציות יוצרות אוטומטית דליים פרטיים:
   `candidate-docs` (מסמכי מועמד), `employee-docs` (מסמכי עובד, 0013),
   `form-uploads` (קבצי טפסים, 0015). אין צורך ליצור ידנית.
4. **חשיפת סכמות ל-Data API.** לוודא ש-`app` **ו-`finance`** חשופות
   (Project Settings → Data API → Exposed schemas). בלי `finance` מודול
   הכספים/השמות ייכשל.
5. **הרשאות service_role.** מיגרציה `0014` מעניקה ל-`service_role` גישה
   לסכמות `app`/`finance` — חובה כדי שפונקציות הקצה (`apply`, `invite-employee`)
   יעבדו. סוד `SERVICE_ROLE_KEY` (המפתח הסודי החדש `sb_secret_…`) חייב להיות
   מוגדר ב-Edge Functions → Secrets.
6. **פונקציית הזמנת עובד.** לפרוס את `invite-employee` (כמו `apply`), ולהוסיף
   את `https://hr-app.ort-tech.co.il` ל-Redirect URLs. תבנית "Invite user" נשלחת
   דרך Resend (מצריך דומיין מאומת לשליחה לכל כתובת).

### אימות כניסה לאזור האישי

- **דוא״ל (ברירת מחדל, ללא תלות בספק):** Authentication → Providers → Email,
  להפעיל "Email OTP". בתבנית המייל לוודא שמופיע `{{ .Token }}` כדי לשלוח קוד
  בן 6 ספרות (ולא רק קישור).
- **טלפון (רשות):** דורש ספק SMS (Twilio וכו') תחת Phone provider.
- **Redirect / Site URL:** להוסיף את דומייני האתרים תחת Authentication → URL Configuration.

---

## 2. פונקציית ההגשה (Edge Function)

מריצה את קליטת המועמדות מהאתר הציבורי (תרחיש 1).

```bash
supabase functions deploy apply --project-ref jsxkwosjtjdypwedzxwx --no-verify-jwt
```

היא משתמשת ב-`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` שמסופקים אוטומטית
לפונקציות. אחרי הפריסה, בפרויקט `hr-public-site` להגדיר משתנה Build:

```
PUBLIC_APPLY_ENDPOINT=https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply
```

ולהריץ Build מחדש.

> **עדכון 0016 — טופס ההגשה ניתן לעריכה מהמערכת.** פונקציית `apply` תומכת
> כעת גם ב-GET (מחזירה את שדות טופס ההגשה הפעיל דרך `app.site_apply_form()`)
> וב-POST שומרת את התשובות הנוספות ב-`applications.answers`. לאחר הרצת מיגרציה
> `0016` יש **לפרוס מחדש** את `apply` ולהריץ Build מחדש ל-`hr-public-site`.
> בבנאי הטפסים (team-app) מסמנים תבנית אחת פעילה כ"טופס ההגשה באתר" —
> שדותיה יופיעו באתר מתחת לשדות הבסיס, בלי פריסה נוספת.

---

## 3. משתני סביבה לפי אתר

### hr-public-site (בנייה בלבד, אין סודות בדפדפן)
- `DATABASE_URL` — מחרוזת ה-Pooler הנקייה (ללא מרכאות/סוגריים). אם לא מוגדר,
  האתר נבנה עם משרות דמה.
- `PUBLIC_APPLY_ENDPOINT` — ראו סעיף 2.

### hr-team-app ו-hr-candidate-app (נחשפים לדפדפן — anon בלבד, לעולם לא service_role)
- `VITE_SUPABASE_URL=https://jsxkwosjtjdypwedzxwx.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<anon key>`

---

## 4. בדיקות לפני פריסה

```bash
npm run db:test              # מיגרציות + כללי עסק + בדיקות אזור המועמד
npm run build:public         # אתר ציבורי
npm run build:team           # ממשק צוות
npm run build:candidate      # אזור אישי
```

---

## 5. סדר עדכון שוטף

1. שינוי קוד → הרצת הבדיקות/בנייה המתאימה מקומית.
2. Commit + push לענף העבודה.
3. Cloudflare בונה אוטומטית מה-Git לכל פרויקט מחובר.
4. שינוי סכמה → SQL Editor + `npm run db:schema` לעדכון הקובץ המאוחד.
