import { useEffect } from 'react';

const BASE = 'URSA GROUP — האזור האישי';

/**
 * מעדכן את <title> לפי הדף (WCAG 2.4.2 — "Page Titled").
 * ב-SPA ה-title לא משתנה מעצמו, וקורא מסך מכריז את אותה כותרת בכל מעבר.
 */
export function useTitle(title?: string): void {
  useEffect(() => {
    document.title = title ? `${title} · ${BASE}` : BASE;
    return () => { document.title = BASE; };
  }, [title]);
}
