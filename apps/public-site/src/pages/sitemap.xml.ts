import type { APIRoute } from 'astro';
import { loadJobs } from '../data/jobs';

// sitemap נבנה בזמן בנייה יחד עם שאר האתר.
export const GET: APIRoute = async ({ site }) => {
  const base = (site?.href ?? 'https://hr.ort-tech.co.il/').replace(/\/$/, '');
  const jobs = await loadJobs();
  const staticPaths = ['/', '/jobs', '/about', '/contact', '/privacy'];
  const urls = [
    ...staticPaths.map(p => ({ loc: base + p, lastmod: undefined as string | undefined })),
    ...jobs.map(j => ({ loc: `${base}/jobs/${j.slug}`, lastmod: j.published_at })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
