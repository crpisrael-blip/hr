# תבניות מייל — Supabase Auth

להדבקה ב-Supabase → **Authentication → Emails → Templates**. לכל תבנית: לשונית משלה,
שדה **Subject** ושדה **Body (HTML)** — למחוק את הגוף הקיים ולהדביק את כל תוכן הקובץ.

| לשונית ב-Supabase | קובץ | Subject |
|---|---|---|
| Invite user | `invite.html` | `הוזמנת להצטרף למערכת URSA GROUP` |
| Magic Link | `magic_link.html` | `קוד הכניסה שלך למערכת URSA GROUP` |
| Confirm signup | `confirmation.html` | `קוד הכניסה שלך למערכת URSA GROUP` |
| Reset password | `recovery.html` | `איפוס סיסמה — URSA GROUP` |

## למה זה חובה (לא רק עיצוב)
אפליקציית המועמד (`my.hr`) מבקשת מהמועמד **להקליד קוד** (`verifyOtp`). תבנית ברירת המחדל
של Supabase שולחת רק קישור — בלי `{{ .Token }}` הקוד לא מגיע וכניסת מועמדים נתקעת.
`signInWithOtp` שולח **Magic Link** למשתמש קיים ו-**Confirm signup** למשתמש חדש — לכן
שתי התבניות מכילות את הקוד.

## משתנים
`{{ .Token }}` קוד 6 ספרות · `{{ .ConfirmationURL }}` קישור חתום · `{{ .SiteURL }}` · `{{ .Email }}`

## מומלץ במקביל (מוניטין מול ספאם)
- רשומת **DMARC** ב-DNS (Cloudflare): `_dmarc` TXT → `v=DMARC1; p=none; rua=mailto:dmarc@ort-tech.co.il`
- ב-Resend → Domains → ort-tech.co.il: **Open/Click tracking כבוי** (מעקב משכתב קישורי כניסה ומזיק לאמון).
- OTP expiry: Authentication → Providers → Email → OTP expiry `3600` (ברירת מחדל) — התבנית אומרת "שעה".
