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
