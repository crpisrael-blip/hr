import { defineConfig } from 'vitest/config';

// בדיקות יחידה ללוגיקה הטהורה של האפליקציות (src/lib, src/data). סביבת node —
// הפונקציות שנבדקות אינן נוגעות ב-DOM או ב-React; מה שכן נוגע ב-Supabase ממוקּ.
// הבדיקות מייבאות describe/it/expect מ-'vitest' במפורש (globals כבוי), כדי
// שלא יידרש שינוי ב-eslint.config.js וכל קובץ בדיקה יעמוד בפני עצמו.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['apps/**/src/**/*.{test,spec}.ts'],
  },
});
