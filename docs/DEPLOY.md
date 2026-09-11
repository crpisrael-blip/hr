# מדריך הפעלה (Runbook)

שלושה רכיבים עצמאיים, כל אחד נפרס לחוד. סודות לעולם לא בקוד — רק במשתני
הסביבה של Cloudflare / Supabase.

| רכיב | תיקיית שורש | Cloudflare project | דומיין |
|------|------------|--------------------|--------|
| אתר ציבורי | `apps/public-site` | `hr-public-site` | `hr.ort-tech.co.il` |
| ממשק צוות | `apps/team-app` | `hr-team-app` | `hr-app.ort-tech.co.il` |
| אזור אישי (my.hr) | `apps/candidate-app` | `hr-candidate-app` | `my.hr.ort-tech.co.il` |

> **Workers, לא Pages.** שלוש האפליקציות נפרסות כ-**Cloudflare Workers
> Static Assets** — זה מה שבלוק `[assets]` שב-`wrangler.toml` מגדיר. תיעוד ישן
> (וגם `docs/SPEC.md` בגרסאות קודמות) דיבר על Cloudflare Pages; זה לא נכון,
> והוגדר מחדש. בלוח הבקרה מחפשים את הפרויקטים תחת **Workers & Pages → Workers**.

בכל פרויקט Cloudflare: משתנה **Build** בשם `NODE_VERSION` בערך `22`
(תואם ל-`.node-version` ול-`engines.node` שב-`package.json`).

---

## 0. טבלת הבנייה — מה להגדיר בכל פרויקט Cloudflare

התיקייה לכל שלושת הפרויקטים היא **שורש הריפו** (monorepo עם npm workspaces:
התלויות מותקנות פעם אחת בשורש, ולכן פקודת בנייה מתוך תיקיית האפליקציה תיכשל).

| Cloudflare project | Root directory | Build command | Deploy command | Output directory | משתני Build נדרשים |
|---|---|---|---|---|---|
| `hr-public-site` | `/` | `npm run build:public` | `npm run deploy:public` | `apps/public-site/dist` | `NODE_VERSION=22`, `DATABASE_URL`, `PUBLIC_APPLY_ENDPOINT`, (רשות) `PUBLIC_SITE_URL` |
| `hr-team-app` | `/` | `npm run build:team` | `npm run deploy:team` | `apps/team-app/dist` | `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `hr-candidate-app` | `/` | `npm run build:candidate` | `npm run deploy:candidate` | `apps/candidate-app/dist` | `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

> ⚠️ **חובה להגדיר את שדה `Deploy command` בכל פרויקט Worker.** אין `wrangler.toml`
> בשורש הריפו (הוסר בכוונה — הוא הצביע על team-app בלבד וקשר את שלושת הפרויקטים
> לאותה אפליקציה). ברירת המחדל של Cloudflare, `npx wrangler deploy`, מריצה
> מ-Root directory (`/`) ולא מוצאת שם קובץ קונפיגורציה — ונכשלת עם
> *"create a wrangler.jsonc … Failed"*. פקודות ה-`deploy:*` שבטבלה מוסיפות
> `--config apps/<app>/wrangler.toml` ומפנות כל פרויקט לאפליקציה הנכונה.

פריסה ידנית מהמכונה — אין `wrangler.toml` בשורש, ולכן כל פקודה מקבלת `--config`:

```bash
npm run build:team && npm run deploy:team          # = wrangler deploy --config apps/team-app/wrangler.toml
npm run build:candidate && npm run deploy:candidate
npm run build:public && npm run deploy:public
```

`npx wrangler versions upload --config apps/team-app/wrangler.toml` מעלה גרסה
בלי להפעיל אותה כגרסת ייצור.

---

## 1. מסד הנתונים (Supabase)

פרויקט `jsxkwosjtjdypwedzxwx` (eu-central-1).

1. **הרצת הסכמה.**
   - **מסד חדש וריק בלבד:** ב-SQL Editor להריץ את `supabase/schema.sql` המאוחד.
     > ⚠️ הקובץ המאוחד **אינו idempotent** — הוא מכיל עשרות `create table`
     > רגילים. הרצה שלו על מסד קיים תיכשל באמצע ותשאיר את המסד במצב חלקי.
   - **מסד קיים:** להריץ **רק את המיגרציות החדשות**, לפי סדר מספרי, אחת-אחת.
   - אחרי כל שינוי במיגרציות: `npm run db:schema` לבניית הקובץ המאוחד מחדש,
     והשינוי נכנס לאותו קומיט. ה-CI נכשל אם `schema.sql` אינו תואם את
     `supabase/migrations/`.
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

## 3. סודות פונקציות הקצה

מוגדרים ב-**Supabase Dashboard → Edge Functions → Secrets**. אינם יושבים
באף קובץ `.env` ואינם מגיעים לבנדל של הדפדפן.

| סוד | נקרא ב | חובה? | ערך |
|---|---|---|---|
| `SERVICE_ROLE_KEY` | `apply`, `invite-employee` | **חובה** | המפתח הסודי `sb_secret_…` של הפרויקט. יש fallback ל-`SUPABASE_SERVICE_ROLE_KEY` שמוזרק אוטומטית, אך עדיף להגדיר מפורשות. |
| `APPLY_ALLOW_ORIGIN` | `apply` | רשות (ראו למטה) | דומיין **אחד** נוסף שמורשה לשלוח את טופס ההגשה, כולל הסכמה: `https://example.com`. ריק = רק הדומיינים שבקוד. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | שתי הפונקציות | — | מוזרקים אוטומטית על ידי Supabase. אין להגדיר ידנית. |

### `APPLY_ALLOW_ORIGIN` — למה הוא קיים

פונקציית `apply` מקבלת `POST` מדפדפן של גולש אנונימי, ולכן היא מחזיקה
allowlist של Origins ל-CORS. ה-allowlist בקוד מכילה את דומייני הייצור
(`hr.ort-tech.co.il`, `my.hr.ort-tech.co.il`). כל דומיין נוסף — סביבת
preview, דומיין `*.workers.dev` זמני לפני חיבור הדומיין המותאם, או מיגרציה
לדומיין חדש — מתווסף **דרך הסוד הזה ולא בעריכת קוד**.

> **היסטורי:** בקוד ישב פעם `hr-public-site.menahemtzik1.workers.dev` — כתובת
> ברירת המחדל של חשבון Cloudflare **אישי**. זה קשר את הייצור לחשבון פרטי,
> בניגוד לכלל "חשבונות הספקים על שם הלקוח" (SPEC:569). היא הוסרה מהקוד;
> אם עדיין נדרשת כתובת `workers.dev` לבדיקות — להגדיר אותה ב-`APPLY_ALLOW_ORIGIN`
> ולנקות אותה כשהדומיין המותאם מחובר.

אחרי שינוי הסוד **אין צורך בפריסה מחדש** של הפונקציה — Supabase טוענת אותו
בהרצה הבאה. לאימות מבחוץ:

```bash
curl -si -X OPTIONS https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply \
  -H 'Origin: https://hr.ort-tech.co.il' \
  -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
```

---

## 4. משתני סביבה לפי אתר

הטבלה המלאה בסעיף 0. הקבצים לדוגמה בריפו: `.env.example` בשורש ו-`.env.example`
בתוך כל אפליקציה — **Vite ו-Astro טוענים `.env` מתיקיית האפליקציה, לא מהשורש.**

### hr-public-site (בנייה בלבד, אין סודות בדפדפן)
- `DATABASE_URL` — מחרוזת ה-Pooler הנקייה (ללא מרכאות/סוגריים). אם לא מוגדר,
  האתר נבנה עם משרות דמה.
- `PUBLIC_APPLY_ENDPOINT` — ראו סעיף 2.
- `PUBLIC_SITE_URL` — כתובת הבסיס לבניית ה-sitemap והקישורים הקנוניים.
  נקרא ב-`astro.config.mjs`. ברירת מחדל בקוד: `https://hr.ort-tech.co.il`.
  להגדיר רק אם האתר מוגש מכתובת אחרת (למשל סביבת staging).

### hr-team-app ו-hr-candidate-app (נחשפים לדפדפן — anon בלבד, לעולם לא service_role)
- `VITE_SUPABASE_URL=https://jsxkwosjtjdypwedzxwx.supabase.co`
- `VITE_SUPABASE_ANON_KEY=<anon key>`

---

## 5. בדיקות לפני פריסה

```bash
npm run db:test              # מיגרציות + כללי עסק + בדיקות אזור המועמד
npm run db:schema            # לוודא ש-schema.sql מסונכרן (ה-CI בודק זאת)
npm run check:public         # typecheck לאתר הציבורי
npm run build:all            # שלוש האפליקציות
```

אותן בדיקות רצות אוטומטית ב-`.github/workflows/ci.yml` על כל Pull Request.

---

## 6. סדר עדכון שוטף

1. ענף מ-`main` → שינוי קוד → הרצת הבדיקות/בנייה המתאימה מקומית.
2. Commit + push → Pull Request. ה-CI חייב להיות ירוק.
3. מיזוג ל-`main` → Cloudflare בונה אוטומטית מה-Git לכל פרויקט מחובר.
4. שינוי סכמה → הרצת המיגרציה החדשה ב-SQL Editor + `npm run db:schema`
   לעדכון הקובץ המאוחד, באותו PR.

---

## 7. שחזור ותקלות

- **Retry deployment בונה מחדש את אותו קומיט ישן.** אחרי דחיפת קוד חדש
  Cloudflare בונה אוטומטית; אם צריך לבנות ידנית — **New deployment**, או Retry
  על השורה **העליונה** בלבד. Retry על שורה ישנה דורס את הפריסה הטובה.
- **חזרה לגרסה קודמת:** Workers & Pages → הפרויקט → Deployments → הגרסה
  הרצויה → Rollback. אינה מחזירה שינויי סכמה — מיגרציה צריך לבטל ידנית.
- **CSP:** ה-CSP של האתר הציבורי ב-`apps/public-site/public/_headers`. כל
  דומיין חיצוני שהדפדפן פונה אליו חייב להופיע ב-`connect-src`.
  אימות: `curl -sI https://hr.ort-tech.co.il/ | grep -i content-security-policy`.

---

## 8. גיבוי

גיבוי יומי מנוהל של Supabase. **מדיניות השחזור טרם הוגדרה ולא נבדקה** —
האפיון מגדיר שחזור נתונים וקבצים כקריטריון קבלה (SPEC:567). לפני עלייה
רשמית לאוויר יש לבצע תרגיל שחזור אחד לפחות ולתעד את משך הזמן שלו כאן.

---

## 9. ענפים, גרסאות ותגיות

**המצב היום:** ברימוט אין ענף `main` כלל. ברירת המחדל היא
`claude/recruitment-placement-spec-fecjmx` — ענף עבודה של סוכן. אין tags, אין
releases, ויש שני ענפי `codex/*` ישנים. אין branch protection, ולכן שום דבר
אינו מונע דחיפה ישירה לענף שממנו Cloudflare בונה לייצור.

**ההגדרה המומלצת** (דורשת הרשאות בעלים ב-GitHub; טרם בוצעה):

1. ליצור `main` מהענף היציב הנוכחי ולהגדיר אותו כ-**default branch**.
2. **Branch protection** על `main`: חובה Pull Request, חובה ש-CI עובר
   (`build`, `db-test`, `edge-functions`), חובה אישור אחד, ללא force-push.
3. לחבר את שלושת פרויקטי Cloudflare ל-`main` במקום לענף הסוכן.
4. למחוק את `codex/ursa-rtl-design` ו-`codex/match-approved-design` אם מוזגו.
5. `.github/CODEOWNERS` — להחליף את `@OWNER` בשם המשתמש או הצוות האמיתי,
   אחרת הכלל לא תופס ולא מתווסף reviewer אוטומטית.

**מודל הענפים: GitHub Flow.** `main` תמיד ניתן לפריסה; ענף קצר-חיים לכל
שינוי (`feat/…`, `fix/…`, `docs/…`), PR, CI ירוק, מיזוג, פריסה.

**מוסכמת קומיטים: Conventional Commits** — `type(scope): subject`.
טיפוסים: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`,
`ci`, `revert`. Scope לדוגמה: `db`, `apply`, `team-app`, `public-site`,
`candidate-app`, `ci`, `deploy`. הנושא בציווי, בלי נקודה בסוף.
(כיום 45 מתוך 51 הקומיטים בטקסט חופשי — המוסכמת חלה מכאן ואילך.)

**תגיות ו-CHANGELOG.** הגרסה של המוצר עוקבת אחרי גרסת האפיון
(`docs/SPEC.md`, כיום 0.12). בכל אבן דרך: לעדכן את `CHANGELOG.md`, לתייג
`git tag -a v0.12 -m "..."` ולדחוף `git push --tags`. התג הוא מה שמאפשר
לומר "הייצור מריץ את v0.12" — כרגע אי אפשר.
