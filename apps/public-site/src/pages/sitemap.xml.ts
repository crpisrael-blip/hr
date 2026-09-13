import type { APIRoute } from 'astro';
import { loadJobs } from '../data/jobs';

const XML_ESC: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
};
const xml = (s: string) => String(s).replace(/[&<>"']/g, c => XML_ESC[c]);

export const GET: APIRoute = async ({ site }) => {
  const base = (site ?? new URL('https://hr.ort-tech.co.il')).origin;
  const jobs = await loadJobs();
  // לוכסן סוגר בכל כתובת, בהתאם ל-trailingSlash: 'always' ול-canonical (B1).
  const staticPaths = ['/', '/jobs/', '/about/', '/contact/', '/privacy/', '/accessibility/'];
  const urls = [
    ...staticPaths.map(p => ({ loc: base + p, lastmod: undefined as string | undefined })),
    // סלאגים יכולים להכיל עברית (ממשק הצוות מייצר אותם) — חייבים קידוד אחוזים.
    ...jobs.map(j => ({ loc: `${base}/jobs/${encodeURIComponent(j.slug)}/`, lastmod: j.published_at })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${xml(u.lastmod)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
