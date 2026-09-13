import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // הפרדת ספריות הצד-שלישי מקוד האפליקציה: הן כמעט לא משתנות,
        // כך שפריסה חדשה לא מבטלת את המטמון שלהן אצל המשתמש.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
