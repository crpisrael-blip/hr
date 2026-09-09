import type { APIRoute } from 'astro';
import { loadJobs } from '../data/jobs';

export const GET: APIRoute = async ({ site }) => {
  const base = (site ?? new URL('https://hr.ort-tech.co.il')).origin;
  const jobs = await loadJobs();
  const staticPaths = ['/', '/jobs', '/about', '/contact', '/privacy', '/accessibility'];
  const urls = [
    ...staticPaths.map(p => ({ loc: base + p, lastmod: undefined as string | undefined })),
    ...jobs.map(j => ({ loc: `${base}/jobs/${j.slug}`, lastmod: j.published_at })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
