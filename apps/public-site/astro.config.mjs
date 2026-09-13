import { defineConfig } from 'astro/config';

// בנייה בייצור (Cloudflare Pages/Workers) חייבת משתני סביבה אמיתיים.
// בלעדיהם האתר היה עולה לאוויר עם משרות דמה (K3) או עם "מצב הדגמה"
// שמציג הצלחה כוזבת ומשליך את המועמדות (K2). בפיתוח מקומי אין חסימה.
//
// GitHub Actions מגדיר CI=true גם לבדיקת קומפילציה שאינה פריסה, ושם מותר
// לבנות ממשרות הדמה. הבדיקה של ה-CI מדליקה ALLOW_DEMO_BUILD=1 במפורש —
// דגל שקובץ ה-workflow המבוקר בלבד מגדיר ו-Cloudflare לעולם לא, ולכן
// ההגנה על הפריסה נשמרת במלואה.
const allowDemoBuild = process.env.ALLOW_DEMO_BUILD === '1';
const isProdBuild =
  !allowDemoBuild &&
  Boolean(process.env.CI || process.env.CF_PAGES || process.env.WORKERS_CI);
if (isProdBuild) {
  const missing = ['PUBLIC_APPLY_ENDPOINT', 'DATABASE_URL'].filter(
    (k) => !process.env[k]?.trim(),
  );
  if (missing.length) {
    throw new Error(
      `[build] חסרים משתני סביבה לבנייה בייצור: ${missing.join(', ')}. ` +
        'בלעדיהם האתר נבנה עם נתוני הדגמה ועם טופס הגשה שאינו שולח לשרת.',
    );
  }
}

// אתר סטטי בלבד. המשרות נצרבות בזמן בנייה ואין גישה למסד בזמן ריצה.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://hr.ort-tech.co.il',
  output: 'static',
  // לוכסן סוגר אחיד: canonical, קישורים פנימיים ו-sitemap מצביעים כולם
  // על אותה כתובת, כך שאין הפניית 307 על כל קליק (B1).
  trailingSlash: 'always',
  build: { inlineStylesheets: 'auto', format: 'directory' },
  compressHTML: true,
  vite: {
    build: {
      // מוציא גם סקריפטים קטנים לקבצים תחת /_astro/ במקום להטמיע אותם
      // ב-HTML. בלי זה אי אפשר להסיר 'unsafe-inline' מה-CSP (B5).
      assetsInlineLimit: 0,
    },
  },
});
