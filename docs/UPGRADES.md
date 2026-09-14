# שדרוגי תלויות

> **עודכן 14.9.2026 — בוצע ✅.** שני שדרוגי ה-major הושלמו:
> `react-router-dom` 6 → **7.18.3** ו-`astro` 5 → **7.3.2**.
> `npm audit --omit=dev` מדווח כעת על **0 פגיעויות ייצור** (מ-5), וצעד ה-audit
> ב-CI חוסם שוב (הוסר `continue-on-error`). נותרו 3 פגיעויות `sharp` **ב-dev
> בלבד**, דרך `wrangler → miniflare` (כלי פריסה שאינו נשלח לייצור); miniflare
> מצמיד `sharp@0.35.2` ולא ניתן ל-dedupe מקומי — ייסגר כש-wrangler יעדכן.
> ההיסטוריה למטה נשמרת לתיעוד ההחלטות שהתקבלו.

---

## רקע (לפני השדרוג)

נכון ל-11.9.2026. `npm audit --omit=dev` דיווח על **5 פגיעויות** — 1 critical,
1 high, 2 moderate, 1 low. **כולן** נסגרו רק בשני שדרוגי major:
`astro@7` ו-`react-router-dom@7`. לא היה תיקון patch זמין לאף אחת מהן.

---

## סדר מומלץ

| # | שדרוג | דחיפות | סיכון | למה בסדר הזה |
|---|---|---|---|---|
| 1 | `react-router-dom` 6 → 7 | בינונית | נמוך-בינוני | נוגע בשתי אפליקציות React בלבד, ללא השפעה על שרשרת הבנייה. שדרוג "חימום" קטן. |
| 2 | `astro` 5 → 7 | **קריטית** | בינוני-גבוה | סוגר את ה-critical, את ה-high (`sharp`) ואת ה-low (`esbuild`) במכה אחת — שלושתם תלויות משנה של Astro. גורר שדרוג Vite ואולי Node. |
| 3 | ניקוי | — | — | להסיר `continue-on-error` מצעד ה-audit ב-CI; להריץ `npm dedupe` (יש כיום 3 גרסאות `esbuild` ו-2 של `sharp`). |

לכל שדרוג: ענף נפרד, PR נפרד, CI ירוק, ובדיקת ידיים באתר/באפליקציה לפני מיזוג.

---

## 1. `react-router-dom` ^6.28.0 → ^7.18.3

**איפה:** `apps/team-app/package.json`, `apps/candidate-app/package.json`
(תלות ישירה בשתיהן; כרגע 6.30.6 בפועל).

**הפגיעויות (moderate):**

| CVE / GHSA | תיאור | רלוונטיות כאן |
|---|---|---|
| bypass ל-CVE-2025-68470 | Open redirect דרך backslash ב-`<Link>` וב-`useNavigate` | **רלוונטי.** שתי האפליקציות הן SPA עם ניווט; ערך נתיב שמגיע מפרמטר URL עלול להפנות החוצה. |
| Arbitrary Constructor Injection ב-`deserializeErrors()` | הידרציה ב-SSR | לא רלוונטי — אין כאן SSR, שתי האפליקציות הן CSR טהור. |

**טווח פגיע:** `6.0.0 – 7.17.0`. **תיקון:** `7.18.3`.

**עבודת ה-breaking change:**
- v7 מחייב React 18 ומעלה — ✅ כבר `^18.3.1` בשתי האפליקציות.
- ה-API של `react-router-dom` מיוזג ל-`react-router`; היבוא `react-router-dom`
  עדיין עובד אך מסומן legacy. יש להחליט אם להחליף את כל היבואים ל-`react-router`
  או להשאיר (עדיף להחליף — פחות חבילות, פחות דריפט).
- ה-future flags של v6.4+ (`v7_startTransition`, `v7_relativeSplatPath`,
  `v7_fetcherPersist`, `v7_normalizeFormMethod`, `v7_partialHydration`,
  `v7_skipActionErrorRevalidation`) הופכים להתנהגות ברירת המחדל. **מומלץ:**
  להדליק אותם קודם אחד-אחד על v6, לוודא שהאפליקציה תקינה, ורק אז לשדרג.
- `json()` ו-`defer()` הוסרו — לבדוק אם בשימוש (הריפו כיום לא משתמש ב-data
  router, אבל לוודא לפני).
- `RouterProvider` ו-`createBrowserRouter` — לבדוק את המעבר אם יעברו אליהם.

**בדיקה אחרי השדרוג:** כניסה ויציאה, כל נתיב מוגן, ניווט אחורה/קדימה בדפדפן,
רענון עמוק (deep link) על נתיב פנימי, ו-404 פנימי של ה-SPA.

---

## 2. `astro` ^5.14.1 → ^7.3.2

**איפה:** `apps/public-site/package.json` (תלות ישירה; כרגע 5.18.2 בפועל).

**הפגיעויות:** טווח פגיע `<= 7.2.7`, חומרה **critical**. עשר התראות באשכול אחד:

| סוג | פירוט | רלוונטיות כאן |
|---|---|---|
| **RCE** | הרצת קוד מרחוק דרך אופטימיזציית תמונות AVIF | **רלוונטי בזמן בנייה.** הבנייה רצה ב-Cloudflare על קוד שלנו, אך כל תמונה שתיכנס לצינור העיבוד הופכת לווקטור. |
| **XSS** ×6 | `define:vars` (סניטציה חלקית של `</script>`), שמות attribute ב-spread props, `renderHTMLElement` (תיקון חלקי ל-CVE-2026-54298), ערכי `transition:*` על islands, מאפייני אנימציה של View Transitions, שם slot לא escaped | **רלוונטי.** האתר הציבורי מגיש HTML לכל העולם. |
| **SSRF** | Host header SSRF בשליפת עמוד שגיאה מ-prerender | רלוונטיות נמוכה — האתר סטטי לחלוטין. |
| **Auth bypass** | חוסר בדיקת גבול path-segment בהסרת ה-`base` המוגדר | לא רלוונטי — אין `base` מוגדר ואין אזור מוגן באתר הציבורי. |
| **Replay** | פרמטרים מוצפנים של server islands חשופים ל-replay בין קומפוננטות | לא רלוונטי — אין server islands. |

**נגררות (נסגרות באותו שדרוג):**
- `sharp <= 0.35.4-rc.0` — **high**. פגיעויות מועברות מ-libvips
  (CVE-2026-33327/33328/35590/35591) ומ-libheif (GHSA-g89c-p67h-r497,
  GHSA-2jg2-4ch7-h545). זו התלות שמאחורי ה-RCE ב-AVIF.
- `esbuild 0.27.3 – 0.28.0` — **low**. קריאת קבצים שרירותית בשרת הפיתוח
  ב-Windows. לא רלוונטי לייצור, רק למפתח על Windows.

**עבודת ה-breaking change (5 → 6 → 7, שני majors):**
- **דרישת Node** עולה. `.node-version` כבר 22 ו-`engines` תוקן ל-`>=22`;
  לאמת מול ה-release notes של 7.x לפני השדרוג ולעדכן את `NODE_VERSION`
  בפרויקט Cloudflare אם צריך.
- **Vite 6 → 7** נגרר. לבדוק את `astro.config.mjs` ואת `PUBLIC_SITE_URL`.
- **Content Collections:** ה-API של `astro:content` השתנה בין המג'ורים
  (Content Layer). הריפו כרגע קורא משרות ישירות מ-`src/data/jobs.ts` ולא
  מ-content collections — לכן ההשפעה צפויה להיות קטנה, אך יש `.astro/content.d.ts`
  מיוצר שצריך להיווצר מחדש.
- **`@astrojs/check`** חייב להישדרג יחד עם Astro, אחרת `npm run check` נשבר.
- לעבור על כל שימוש ב-`define:vars` ובפרוסת attributes בקומפוננטות
  שב-`src/components/` — אלה בדיוק המקומות שה-XSS ישב בהם, וההתנהגות
  אחרי התיקון מחמירה יותר.

**בדיקה אחרי השדרוג:** `npm run build:public` + `npm run check --workspace=@hr/public-site`,
ואז מעבר ידני: עמוד הבית, רשימת המשרות, עמוד משרה, טופס ההגשה (GET לשדות
הדינמיים + POST), sitemap, 404, וה-CSP ב-`public/_headers`.

---

## מה שאינו פגיעות אבל כדאי באותה הזדמנות

- **`npm dedupe`** — ✅ בוצע. מה שנותר (`esbuild`, `sharp` בכמה גרסאות) נעול
  על ידי טווחים לא-תואמים של `astro`/`vite`/`wrangler` ויתקפל רק עם שדרוגי
  ה-major למעלה.
- **ESLint / Prettier / `.editorconfig`** — ✅ נוספו. `eslint.config.js` (flat
  config, רמת recommended) נאכף ב-CI (`npm run lint`, 0 errors; warnings אינם
  חוסמים — `any` מכוון לשורות Supabase). Prettier (`npm run format`) זמין אך
  **אינו** נאכף: הקוד מיישר עמודות ביד במכוון, ו-reformat גורף היה מוחק זאת.
- **אין אף `*.test.*`** בשלוש האפליקציות. עדיין פתוח: Vitest ל-`src/lib/`
  (לוגיקת פורמט/טפסים/שלבים אינה מכוסה; בדיקות ה-SQL מכסות רק את המסד).
- **דריפט בין האפליקציות** — `apps/team-app` ו-`apps/candidate-app` מחזיקות
  `tsconfig.json` ו-`vite.config.ts` כמעט זהים. ניתן לאחד ל-`tsconfig.base.json`
  בשורש בלי לפגוע במודל המידור (קונפיג אינו קוד רץ משותף).
