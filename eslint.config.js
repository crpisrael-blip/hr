// ESLint flat config למונורפו. שלוש אפליקציות: שתיים React (team/candidate)
// ואחת Astro (public-site). הכללים ברמת recommended — לתפוס באגים אמיתיים
// (משתנים לא בשימוש, תלויות hooks, no-undef) בלי type-checking כבד שמאט וגם
// דורש parserOptions.project. עיצוב (רווחים, יישור) אינו באחריות ESLint —
// הקוד מיישר עמודות ביד במכוון; ראו .prettierrc.json.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import astro from 'eslint-plugin-astro';
import globals from 'globals';

export default tseslint.config(
  // תוצרים ותלויות — לא נבדקים.
  {
    ignores: [
      '**/dist/**',
      '**/.astro/**',
      '**/.output/**',
      '**/.wrangler/**',
      '**/node_modules/**',
      'supabase/schema.sql',
    ],
  },

  // בסיס לכל קובץ JS/TS.
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // אפליקציות React (team-app, candidate-app) — רצות בדפדפן.
  {
    files: ['apps/team-app/**/*.{ts,tsx}', 'apps/candidate-app/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // האתר הציבורי (Astro) — קוד בנייה, רץ ב-Node.
  ...astro.configs.recommended,
  {
    files: ['apps/public-site/**/*.{ts,astro}'],
    languageOptions: { globals: { ...globals.node } },
  },

  // קובצי קונפיג בשורש — Node.
  {
    files: ['*.{js,mjs,cjs}', '**/*.config.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    rules: {
      // משתנה/ארגומנט שמתחיל ב-_ הוא "לא בשימוש במכוון".
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // הקוד משתמש ב-any במכוון לשורות דינמיות מ-Supabase (PostgREST מחזיר
      // צורות משתנות). זו הערה שווה-תשומת-לב, לא באג שחוסם בנייה — warn.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
