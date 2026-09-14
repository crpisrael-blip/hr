# פונקציות Supabase Edge

## apply — הגשת מועמדות מהאתר הציבורי (תרחיש 1)

נקודת קצה לכתיבה בלבד. מאמתת פרטים, מזהה כפילות לפי טלפון מנורמל,
יוצרת מועמד (או מקשרת לקיים), פותחת מועמדות (עמידה ללחיצה כפולה),
ופותחת משימת טיפול למגייס האחראי.

### פריסה (דורש Supabase CLI מחובר לפרויקט)

```bash
supabase functions deploy apply --project-ref jsxkwosjtjdypwedzxwx --no-verify-jwt
```

`--no-verify-jwt` כי זו נקודה ציבורית לאנונימיים. משתני הסביבה
`SUPABASE_URL` ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית לפונקציה.

### חיבור האתר הציבורי

כתובת הפונקציה:
`https://jsxkwosjtjdypwedzxwx.supabase.co/functions/v1/apply`

הגדירו אותה כמשתנה בנייה `PUBLIC_APPLY_ENDPOINT` בפרויקט `hr-public-site`
ב-Cloudflare, ואז בנייה מחדש. טופס ההגשה ישלח אליה במקום מצב ההדגמה.

## analyze-cv — ניתוח קורות חיים ב-AI (Claude)

נקודת קצה מאומתת (JWT). מאמתת שהקורא הוא עובד צוות פעיל, בודקת שמתג
`ai.enabled` דלוק, מורידה את הקובץ מ-`candidate-docs`, שולחת אותו ל-Claude
לחילוץ מובנה (PDF נשלח ישירות; DOCX מחולץ לטקסט), ורושמת את התוצאה
ב-`app.document_analyses` כהצעה בלבד. מפתח ה-API נשאר בצד-שרת.

### סוד נדרש (פעם אחת)

ב-Supabase Dashboard → Edge Functions → Secrets הוסיפו:

```
ANTHROPIC_API_KEY = <המפתח מ-console.anthropic.com>
```

(אופציונלי: `ANALYZE_ALLOW_ORIGIN` לדומיינים נוספים מעבר ל-hr-app.ort-tech.co.il.)

### פריסה

```bash
supabase functions deploy analyze-cv --project-ref jsxkwosjtjdypwedzxwx
```

בלי `--no-verify-jwt` — זו נקודה מאומתת. `SUPABASE_URL`, `SUPABASE_ANON_KEY`
ו-`SUPABASE_SERVICE_ROLE_KEY` מוזרקים אוטומטית.

### הפעלה

מריצים את מיגרציה `0029_cv_ai_analysis.sql`, ואז בהגדרות → AI מפעילים את
המתג, בוחרים מודל וקובעים מכסה חודשית. הניתוח עצמו נעשה מכרטיס המועמד →
"ניתוח קורות חיים (AI)".
