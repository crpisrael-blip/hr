import { defineConfig } from 'astro/config';

// אתר סטטי בלבד. המשרות נצרבות בזמן בנייה ואין גישה למסד בזמן ריצה.
export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? 'https://hr.ort-tech.co.il',
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  compressHTML: true,
});
