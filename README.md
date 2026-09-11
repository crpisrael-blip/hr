# HR — מערכת גיוס והשמה

אתר ציבורי עם משרות והגשת מועמדות, אזור אישי למועמדים, וממשק פנימי לניהול הגיוס, הלקוחות, המשימות והכספים.

האפיון המלא: [`docs/SPEC.md`](docs/SPEC.md) (גרסה 0.12).
**מה מתוכו באמת ממומש:** [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) — האפיון מתאר גם יעדים שטרם נבנו, ובכמה נקודות הקוד עושה דבר אחר. בכל סתירה, הקוד הוא האמת.

## מודל המידור

שלושה אזורי אמון, שלוש כתובות, שלוש פריסות נפרדות. אין קוד משותף בין הבנדלים.

| אזור | כתובת | גישה למסד |
|---|---|---|
| ציבורי | hr.ort-tech.co.il | אין. HTML סטטי; המשרות נצרבות בזמן בנייה |
| מועמדים | my.hr.ort-tech.co.il | דרך Supabase, בהיקף החשבון בלבד |
| צוות | hr-app.ort-tech.co.il | דרך Supabase, לפי מטריצת ההרשאות |

האפיון מגדיר שכבת API כנקודת אכיפה יחידה ו-RLS כרשת ביטחון שנייה. **שכבת ה-API טרם נבנתה** — ראו סעיף 1 ב-[`IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## מבנה

```
docs/SPEC.md                  האפיון. מקור האמת לכללי העסק
docs/IMPLEMENTATION_STATUS.md האפיון מול הקוד — מה נבנה ומה לא
docs/DEPLOY.md                מדריך הפעלה: פריסה, משתני סביבה, סדר עדכון
docs/CONFIG_CHECKLIST.md      מה נותר להגדיר מחוץ לקוד
docs/UPGRADES.md              שדרוגי התלויות הפתוחים (astro@7, react-router@7)
supabase/migrations/          הסכימה. גם מסמך השדות בפועל
supabase/tests/               בדיקות רגרסיה לכללי העסק
supabase/functions/           פונקציות קצה (Deno): apply, invite-employee
scripts/db-test.sh            מריץ מיגרציות ובדיקות על מסד חד-פעמי
scripts/build-schema.sh       מאחד את המיגרציות ל-supabase/schema.sql
apps/public-site/             האתר הציבורי (Astro) — בייצור
apps/team-app/                ממשק הצוות (React + Vite) — בייצור
apps/candidate-app/           האזור האישי למועמדים (React + Vite) — בייצור
.github/workflows/ci.yml      בנייה, typecheck, drift של הסכימה, בדיקות DB
```

**אין תיקיית `packages/`, ולא אמורה להיות.** זו החלטה ולא חוסר: מודל המידור קובע שאין קוד משותף בין הבנדלים, כך שפריצה באזור אחד לא מגיעה לאחר. חבילה משותפת בין `team-app` ל-`candidate-app` תייצר בדיוק את הקשר שהמודל מונע, ותהפוך כל שינוי בה לשינוי בשני אזורי אמון בו-זמנית. המחיר הוא שקבצים כמו `src/lib/supabase.ts`, `src/lib/auth.tsx` ו-`src/lib/errors.ts` קיימים בשתי האפליקציות ומתפצלים עם הזמן — זה מחיר מודע. אם בעתיד יידרש קוד משותף **לצד השרת בלבד** (בין פונקציות קצה), מקומו ב-`supabase/functions/_shared/`, לא בחבילת npm שנארזת לתוך בנדל של דפדפן. ה-glob `packages/*` הוסר מ-`workspaces` שב-`package.json`.

## המיגרציות

`supabase/migrations/` — קבצים ממוספרים מ-`0001` ומעלה, מורצים לפי סדר מספרי. **הם מקור האמת לשדות ולכללים**, ורשימה ידנית כאן הייתה מתיישנת בכל מיגרציה חדשה (הגרסה הקודמת של README מנתה שבע מתוך עשרים ואחת). `ls supabase/migrations/` לרשימה העדכנית; לכל קובץ כותרת עברית שמסבירה מה הוא עושה.

הקבוצות: `0001`–`0007` הבסיס — סכמות, טיפוסים, CRM, מועמדים, משימות, כספים ונוסחת המדרגות; `0008`–`0014` הרשאות, RLS, אזור המועמד, מנוע הבונוסים והרשאות `service_role`; `0015`–`0019` מנוע הטפסים, השדות המותאמים ולוג שלבי המשרה; `0020` ומעלה תיקוני חישוב והקשחת אבטחה.

`supabase/schema.sql` הוא שרשור כל המיגרציות להדבקה ב-SQL Editor. הוא **נבנה** ולא נערך: אחרי כל מיגרציה חדשה מריצים `npm run db:schema` ומקמטים את השינוי. ה-CI נכשל אם הקובץ אינו תואם.

## דרישות

Node **22 ומעלה** (`.node-version`). `wrangler` ו-`@supabase/supabase-js` דורשים זאת; על Node 20 ההתקנה תעבור עם אזהרות ותיכשל בזמן ריצה.

## בנייה

```bash
npm ci                    # התקנה, משורש הריפו
npm run build:public      # אתר ציבורי   → apps/public-site/dist
npm run build:team        # ממשק צוות    → apps/team-app/dist
npm run build:candidate   # אזור אישי    → apps/candidate-app/dist
npm run build:all         # שלושתם
npm run check:public      # typecheck לאתר הציבורי (astro check)
```

`npm run build` בלי סיומת בונה את ממשק הצוות בלבד — זו ברירת המחדל ההיסטורית.

שלוש האפליקציות נפרסות כ-**Cloudflare Workers Static Assets** (לא Pages). לכל אחת `wrangler.toml` משלה עם בלוק `[assets]`; אין `wrangler.toml` בשורש, ולכן כל פקודת wrangler מקבלת `--config` מפורש:

```bash
npm run deploy:team       # wrangler deploy --config apps/team-app/wrangler.toml
npm run deploy:candidate
npm run deploy:public
```

`wrangler` מותקן כ-devDependency **אחד בשורש** ולא בכל אפליקציה בנפרד (הוא גורר ~242MB של workerd ו-miniflare).

טבלת הבנייה המלאה לכל פרויקט Cloudflare — פקודה, תיקיית פלט ומשתני סביבה — ב-[`docs/DEPLOY.md`](docs/DEPLOY.md).

## משתני סביבה

Vite ו-Astro טוענים `.env` **מתיקיית האפליקציה**, לא מהשורש. לכן:

| קובץ | מה יש בו |
|---|---|
| `.env.example` | `DATABASE_URL` לכלי הפיתוח (`scripts/db-test.sh`) |
| `apps/public-site/.env.example` | `DATABASE_URL` (בנייה), `PUBLIC_APPLY_ENDPOINT`, `PUBLIC_SITE_URL` |
| `apps/team-app/.env.example` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |
| `apps/candidate-app/.env.example` | אותם שניים |

סודות של פונקציות הקצה (`SERVICE_ROLE_KEY`, `APPLY_ALLOW_ORIGIN`) יושבים ב-Supabase → Edge Functions → Secrets ולא בקובץ `.env`. **לעולם לא להכניס מפתח service-role למשתנה `VITE_`** — הוא נצרב לבנדל ונחשף לדפדפן.

## הרצת בדיקות

```bash
npm run db:test
```

מקים Postgres זמני משלו, מריץ את כל המיגרציות ואז את כל הקבצים ב-`supabase/tests/`, ומוחק את המסד. דורש שרת Postgres מותקן (`postgresql-16` ומעלה); הסקריפט מאתר את הבינאריים דרך `pg_config` ונופל חזרה לנתיבי Debian ו-Homebrew.

מול מסד קיים:

```bash
DATABASE_URL=postgres://... npm run db:test -- --yes-destroy
```

> **הרצה במצב `DATABASE_URL` היא הרסנית.** המיגרציות אינן idempotent (עשרות `create table` רגילים) והבדיקות מכניסות שורות בלי לגלגל אותן לאחור. המסד חייב להיות **ריק וחד-פעמי** — container, לא מסד עבודה ובשום אופן לא הייצור. הסקריפט מסרב לרוץ אלא אם היעד נראה חד-פעמי (מארח מקומי, או שם מסד עם `test`/`tmp`/`scratch`/`_ci`) או שניתן `--yes-destroy` במפורש.

הבדיקות מאמתות בין השאר את דוגמת הבונוס שבאפיון (חמש השמות, שני יעדים, תוצאה 1,800), את פיצול ההשמה החוצה גבול מדרגה, ואת השוואת סכום לוח התשלומים לעמלה. קובץ `.sql` חדש ב-`supabase/tests/` נאסף אוטומטית — אין רשימה לעדכן.

## CI

`.github/workflows/ci.yml` רץ על כל Pull Request ועל push ל-`main`:

| Job | מה הוא עושה |
|---|---|
| `build` | `npm ci`, בניית שלוש האפליקציות, `astro check` לאתר הציבורי, אימות ש-`schema.sql` תואם את המיגרציות, `npm audit --omit=dev` |
| `db-test` | `scripts/db-test.sh` מול service container של `postgres:16` |
| `edge-functions` | `deno check` על כל `supabase/functions/**/*.ts` |

צעד ה-`npm audit` מסומן `continue-on-error` עד לביצוע שדרוגי ה-major שב-[`docs/UPGRADES.md`](docs/UPGRADES.md) — יש להסיר את הסימון מיד אחריהם.

## תלויות ואבטחה

`npm audit --omit=dev` מדווח כיום על 5 פגיעויות, כולל **critical** ב-`astro` (XSS, RCE דרך AVIF) ו-moderate ב-`react-router`. שתיהן נסגרות רק בשדרוגי major שטרם בוצעו. הפירוט המלא, עבודת ה-breaking change וסדר הביצוע המומלץ: [`docs/UPGRADES.md`](docs/UPGRADES.md).

## Git

**אין כרגע ענף `main`** — ברירת המחדל ברימוט היא ענף עבודה של סוכן. ההגדרה המומלצת, מוסכמת הקומיטים ומדיניות התגיות מתועדות ב-[`docs/DEPLOY.md`](docs/DEPLOY.md#9-ענפים-גרסאות-ותגיות). שינויים משמעותיים נרשמים ב-[`CHANGELOG.md`](CHANGELOG.md).

## תיקיית `.claude/`

הריפו נושא 127 קבצים (~1.85MB) תחת `.claude/` — יותר משאר הריפו. רלוונטיים לעבודה כאן:

| סקיל | למה |
|---|---|
| `git-workflow` | מוסכמת הקומיטים והענפים שהריפו הזה משתמש בה |
| `postgres-patterns` | סכימה, אינדקסים ו-RLS |
| `backend-patterns`, `api-design`, `error-handling` | פונקציות הקצה |
| `israeli-ui-design-system`, `accessibility`, `design-system` | ממשק RTL בעברית ועמוד הנגישות |
| `code-review`, `security-review`, `coding-standards` | סקירה לפני מיזוג |

השאר — `israeli-arnona-optimizer`, `israeli-bituach-leumi` (כולל `evidence.json` במשקל 210KB), `israeli-fines-fighter`, `israeli-rental-agreements`, `hebrew-seo-geo-toolkit` ועוד — אינם קשורים למוצר הזה. **מקומם ב-`~/.claude/skills` הגלובלי של המשתמש, לא בריפו.** ההעברה היא החלטה של בעל הריפו ולא בוצעה כאן. שימו לב ששלושה מהסקילים מרחיבים הרשאות (`Bash(python:*)`, `Bash(pip:*)`, `WebFetch`) לכל מי שעובד בריפו.

## מוסכמות

- סכומים כספיים ב-`numeric`, לעולם לא נקודה צפה. עיגול לאגורה בסוף החישוב בלבד.
- נתון לא ידוע נשמר כ-`null`, לא כאפס.
- ההרשאות, חשיפת השלבים, כללי האוטומציה וההסכמים הם נתונים הנערכים מהמערכת, לא ערכים בקוד.
- יומן הביקורת ניתן להוספה בלבד.
- קומיטים בפורמט `type(scope): subject` — `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `perf`.
