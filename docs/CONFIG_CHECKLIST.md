# רשימת בדיקה — הגדרות פריסה שנותרו

מסמך מעשי: כל מה שצריך להגדיר מחוץ לקוד כדי שהמערכת תעבוד מקצה לקצה.
מסומן ✅ = אומת שתקין · ⚠️ = דורש פעולה.

מזהה פרויקט Supabase: `jsxkwosjtjdypwedzxwx` (eu-central-1)

---

## 1. Supabase — מסד נתונים

### 1.1 מיגרציות SQL ✅ (רובן רצו)
כל הטבלאות קיימות. אם משהו לא עובד, ודאי שכל המיגרציות ב-`supabase/migrations/`
רצו ב-SQL Editor **לפי סדר מספרי**, מ-`0001` ומעלה. הרשימה כאן עצרה פעם
ב-`0019` — יש לוודא שגם `0020` ו-`0021` (תיקוני חישוב הבונוס) וכל מיגרציה
שנוספה אחריהן (`0022` ומעלה) רצו בייצור.

הרשימה כאן לא תתוחזק ידנית: `ls supabase/migrations/` הוא מקור האמת, ובכל
מיגרציה חדשה יש להריץ אותה כאן ואז `npm run db:schema` בריפו.

> ⚠️ `supabase/schema.sql` המאוחד מיועד ל**מסד חדש וריק בלבד** — הוא אינו
> idempotent. על מסד קיים מריצים רק את המיגרציות החדשות, אחת-אחת.

### 1.2 שגיאת הבונוס ✅ תוקנה
"column definition list is redundant" — הגורם היה בגוף `compute_monthly_bonus`
(unnest על טיפוס מורכב עם רשימת עמודות). תוקן במיגרציה `0021`. אומת בייצור.

### 1.3 חשיפת סכימות ✅ מאומת
`app` ו-`finance` חשופות ב-Settings → API → Exposed schemas. אין צורך לגעת.

---

## 2. Supabase — Edge Functions

### 2.1 פונקציית `apply` ✅ פרוסה בגרסה העדכנית
אומת: GET מחזיר `{"fields":[]}`, POST מגיע למסד, CORS תקין מ-`hr.ort-tech.co.il`.
- הסוד `SERVICE_ROLE_KEY` = הערך `sb_secret_...` — ✅ מוגדר.
- דומיינים מורשים (CORS) בקוד: `hr.ort-tech.co.il`, `my.hr.ort-tech.co.il`.
- **`APPLY_ALLOW_ORIGIN` — סוד רשות.** דומיין **אחד** נוסף שמורשה לשלוח את
  הטופס, כולל הסכמה (`https://…`). ריק = רק הדומיינים שבקוד. משמש לסביבת
  preview, לכתובת `*.workers.dev` זמנית לפני חיבור הדומיין המותאם, או
  למיגרציה לדומיין חדש — במקום לערוך קוד ולפרוס מחדש.
  מוגדר ב-Edge Functions → Secrets; **אינו דורש פריסה מחדש** של הפונקציה.
  > הכתובת האישית `hr-public-site.menahemtzik1.workers.dev` הוסרה מהקוד —
  > היא קשרה את הייצור לחשבון Cloudflare פרטי. אם היא עדיין נדרשת לבדיקה,
  > מקומה כאן, ויש לנקות אותה כשהדומיין המותאם מחובר.
  אימות:
  ```bash
  curl -si -X OPTIONS https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply \
    -H 'Origin: https://hr.ort-tech.co.il' \
    -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
  ```
- לפריסה מחדש בעתיד: Dashboard → Edge Functions → `apply` → להדביק את
  `supabase/functions/apply/index.ts` → Deploy.

### 2.2 פונקציית `invite-employee` — ⚠️ תלויה ב-Resend + Redirect
פרוסה, אך שליחת המייל תלויה בסעיף 4 (Resend) ובסעיף 3 (Redirect URLs).

### 2.3 פונקציית `analyze-cv` — ניתוח קורות חיים ב-AI (חדש)
פונקציה מאומתת (JWT). הפעלה חד-פעמית:
- להריץ מיגרציות `0029` + `0030` ב-SQL Editor.
- להוסיף סוד `ANTHROPIC_API_KEY` (מ-console.anthropic.com) ב-Edge Functions → Secrets.
- לפרוס: `supabase functions deploy analyze-cv --project-ref jsxkwosjtjdypwedzxwx`
  (או Dashboard → Edge Functions → הדבקת `supabase/functions/analyze-cv/index.ts`).
- בהגדרות → **AI**: להדליק את המתג, לבחור מודל, לקבוע מכסה חודשית.
- לפרוס מחדש את `apply` (תיקון: כשל בהעלאת קו״ח נרשם כפעילות גלויה במקום להיבלע).

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

## 5. Cloudflare Workers — אתר ציבורי (`hr-public-site`) ✅ מוגדר

> **שלושת הפרויקטים הם Workers (Static Assets), לא Pages.** זה מה שבלוק
> `[assets]` שב-`wrangler.toml` מגדיר, ובלוח הבקרה הם יושבים תחת
> Workers & Pages → **Workers**. תיעוד קודם קרא להם Pages — לא נכון, תוקן.
> טבלת הבנייה המלאה (Root directory, Build command, Output directory):
> `docs/DEPLOY.md` סעיף 0.
משתני הסביבה (Settings → Environment variables → Production):
| משתנה | ערך |
|---|---|
| `DATABASE_URL` | מחרוזת החיבור מ-Supabase (Connect → ORM → השורה `DATABASE_URL`, pooler 6543, עם הסיסמה האמיתית במקום `[YOUR-PASSWORD]`). |
| `PUBLIC_APPLY_ENDPOINT` | **בדיוק** `https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply` — בלי שם המשתנה, בלי `=`, בלי גרשיים. |

בלוג הבנייה צריך להופיע `[jobs] נצרבו N משרות מהמסד`.

> אבטחה: `DATABASE_URL` מכיל סיסמה — מגדירים אותו רק ב-Cloudflare,
> לעולם לא בקוד ולא בצ׳אט.

### לקחים מההגדרה (חשוב לפריסות הבאות)
- **Retry deployment בונה מחדש את אותו קומיט ישן.** אחרי דחיפת קוד חדש
  Cloudflare בונה אוטומטית; אם צריך לבנות ידנית — **New deployment** או
  Retry על השורה **העליונה** בלבד. Retry על שורה ישנה דורס את הפריסה הטובה.
- ה-CSP של האתר נמצא ב-`apps/public-site/public/_headers`. כל דומיין חיצוני
  שהדפדפן צריך לפנות אליו חייב להופיע ב-`connect-src` (Supabase כבר שם).
- אימות מהיר מבחוץ: `curl -sI https://hr.ort-tech.co.il/ | grep -i content-security-policy`.

---

## 6. Cloudflare Workers — אפליקציות הצוות/המועמד ✅ פועלות
`hr-app` (צוות) ו-`my.hr` (מועמד) עובדות. אחרי כל דחיפה לענף — Cloudflare בונה
מחדש; לראות שינויים חדשים צריך גם **רענון קשיח** בדפדפן (Ctrl+Shift+R).
משתני הסביבה שלהן (כבר מוגדרים):
```
VITE_SUPABASE_URL=https://jsxkwosjtjdypwedzxwx.supabase.co
VITE_SUPABASE_ANON_KEY=<sb_publishable_...>
```
בשתיהן `NODE_VERSION=22` (תואם ל-`.node-version` ול-`engines.node`).
משתני `VITE_*` נצרבים לתוך הבנדל ונחשפים לדפדפן — **anon בלבד, לעולם לא
service-role ולא `DATABASE_URL`**.

---

## מצב נוכחי
- סעיף 4 (Resend) ✅ מאומת · סעיף 3.2 (SMTP) ✅ מיילים יוצאים (הזמנה הגיעה).
- ✅ הגשת מועמדות מהאתר עובדת מקצה לקצה.

## מה נשאר (מיילים: מספאם לתיבה + קוד OTP)
1. **תבניות מייל בעברית** — `supabase/templates/` (README שם). **חובה**: תבנית ברירת
   המחדל שולחת קישור בלי `{{ .Token }}`, ואפליקציית המועמד מבקשת להקליד קוד.
2. **DMARC** ב-Cloudflare DNS: `_dmarc` TXT → `v=DMARC1; p=none; rua=mailto:dmarc@ort-tech.co.il`
   (SPF ו-DKIM כבר תקינים — נבדק; DMARC חסר, וזה מה ש-Gmail מעניש).
3. **Resend → Domains → ort-tech.co.il → Open/Click tracking כבוי.**
4. **סעיף 3.1** — לוודא ש-Redirect URLs מוגדרים (הקישור בהזמנה צריך להוביל ל-`hr-app.ort-tech.co.il`).
