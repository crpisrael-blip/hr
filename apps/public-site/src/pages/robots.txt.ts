import type { APIRoute } from 'astro';

// נבנה כנתיב ולא כקובץ סטטי, כדי שכתובת ה-sitemap תיגזר מ-PUBLIC_SITE_URL
// ולא תהיה קשיחה לדומיין הייצור (N3).
export const GET: APIRoute = ({ site }) => {
  const base = (site ?? new URL('https://hr.ort-tech.co.il')).origin;
  // אין Disallow על /apply/: עמודי ההגשה נושאים noindex, וחסימה ב-robots
  // הייתה מונעת מגוגל לראות את ה-noindex מלכתחילה (B4).
  const body = `User-agent: *
Allow: /

Sitemap: ${base}/sitemap.xml
`;
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
