# רשימת בדיקה — הגדרות פריסה שנותרו

מסמך מעשי: כל מה שצריך להגדיר מחוץ לקוד כדי שהמערכת תעבוד מקצה לקצה.
מסומן ✅ = אומת שתקין · ⚠️ = דורש פעולה.

מזהה פרויקט Supabase: `jsxkwosjtjdypwedzxwx` (eu-central-1)

---

## 1. Supabase — מסד נתונים

### 1.1 מיגרציות SQL ✅ (רובן רצו)
כל הטבלאות קיימות. אם משהו לא עובד, ודאי שכל המיגרציות רצו לפי הסדר ב-SQL Editor:
`0013 → 0014 → 0015 → 0016 → 0017 → 0018 → 0019`.

### 1.2 רענון מטמון סכימה — ⚠️ להריץ פעם אחת
לתיקון שגיאת הבונוס ("column definition list is redundant"):
```sql
notify pgrst, 'reload schema';
```

### 1.3 חשיפת סכימות ✅ מאומת
`app` ו-`finance` חשופות ב-Settings → API → Exposed schemas. אין צורך לגעת.

---

## 2. Supabase — Edge Functions

### 2.1 פונקציית `apply` — ⚠️ לפרוס מחדש
הגרסה הפרוסה ישנה (לא תומכת בשאלות דינמיות/שמירת תשובות).
Dashboard → Edge Functions → `apply` → Edit → להדביק את התוכן העדכני מ-
`supabase/functions/apply/index.ts` → Deploy.
- הסוד `SERVICE_ROLE_KEY` = הערך `sb_secret_...` — ✅ כבר מוגדר (ה-POST עובד).

### 2.2 פונקציית `invite-employee` — ⚠️ תלויה ב-Resend + Redirect
פרוסה, אך שליחת המייל תלויה בסעיף 4 (Resend) ובסעיף 3 (Redirect URLs).

---

## 3. Supabase — Authentication

### 3.1 Redirect URLs — ⚠️ להוסיף
Authentication → URL Configuration → Redirect URLs, להוסיף:
```
https://my.hr.ort-tech.co.il/**
https://hr-app.ort-tech.co.il/**
```
(נדרש גם ל-OTP של המועמד וגם לקישור ההזמנה למגייס.)

### 3.2 SMTP (מייל יוצא) — ⚠️ אחרי אימות הדומיין (סעיף 4)
Authentication → Emails → SMTP Settings:
| שדה | ערך |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) או `587` |
| Username | `resend` |
| Password | מפתח ה-API של Resend (`re_...`) |
| Sender email | `noreply@ort-tech.co.il` |
| Sender name | URSA GROUP |

---

## 4. Resend — אימות דומיין ⚠️
1. Resend → Domains → `ort-tech.co.il` → להוסיף את רשומות ה-DNS (SPF/DKIM/MX)
   שהם נותנים, אצל ספק ה-DNS (Cloudflare).
2. להמתין לסטטוס **Verified**.
3. ליצור API Key → להכניס ל-SMTP של Supabase (סעיף 3.2).
> עד לאימות: שרת המבחן `onboarding@resend.dev` שולח מיילים **רק** לכתובת בעל
> החשבון — לכן הזמנות לכתובות אחרות נכשלות.

---

## 5. Cloudflare Pages — אתר ציבורי (`hr-public-site`) ⚠️
בעיה נוכחית: האתר נבנה עם **נתוני דמו** (משרות שה-slug שלהן לא קיים במסד),
ולכן הגשת מועמדות נכשלת ("אירעה תקלה").

Settings → Environment variables (Production), להוסיף:
| משתנה | ערך |
|---|---|
| `DATABASE_URL` | מחרוזת החיבור מ-Supabase: Settings → Database → Connection string → **URI** (מומלץ ה-pooler, פורט 6543). כולל הסיסמה. |
| `PUBLIC_APPLY_ENDPOINT` | `https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply` |

ואז **Retry deployment / Rebuild**. אחרי הבנייה האתר יציג משרות אמיתיות
עם slug תקין, וההגשה תעבוד (למשרה שסטטוסה "מפורסמת").

> אבטחה: `DATABASE_URL` מכיל סיסמה — מגדירים אותו רק כמשתנה Build ב-Cloudflare,
> לעולם לא בקוד ולא בצ׳אט.

---

## 6. Cloudflare Pages — אפליקציות הצוות/המועמד ✅ פועלות
`hr-app` (צוות) ו-`my.hr` (מועמד) עובדות. אחרי כל דחיפה לענף — Cloudflare בונה
מחדש; לראות שינויים חדשים צריך גם **רענון קשיח** בדפדפן (Ctrl+Shift+R).
משתני הסביבה שלהן (כבר מוגדרים):
```
VITE_SUPABASE_URL=https://jsxkwosjtjdypwedzxwx.supabase.co
VITE_SUPABASE_ANON_KEY=<sb_publishable_...>
```

---

## סדר עדיפויות מומלץ
1. **סעיף 1.2** — רענון סכימה (מתקן בונוס מיד).
2. **סעיף 5** — `DATABASE_URL` + Rebuild (מתקן הגשת מועמדות).
3. **סעיף 2.1** — פריסת `apply` מחדש (שאלות דינמיות + תשובות).
4. **סעיף 4 + 3** — Resend + Redirect (מתקן הזמנות מייל ו-OTP).
