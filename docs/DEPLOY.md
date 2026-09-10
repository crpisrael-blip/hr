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
3. **אחסון מסמכים.** מיגרציה `0011` יוצרת אוטומטית דלי פרטי בשם
   `candidate-docs` ואת מדיניות הגישה (מועמד רואה רק את שלו, צוות רואה הכול).
   אין צורך ליצור אותו ידנית.
4. **חשיפת סכמות ל-Data API.** לוודא ש-`app` ו-`finance` חשופות
   (Project Settings → Data API → Exposed schemas).

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
