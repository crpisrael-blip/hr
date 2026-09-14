import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatDate,
  money,
  moneyRound,
  fmtSize,
  initials,
  safeUrl,
  slugify,
  safeFileName,
  label,
  JOB_STAGE,
} from './format';

afterEach(() => vi.restoreAllMocks());

describe('formatDate', () => {
  it('מעצב DD/MM/YYYY עם לוכסנים', () => {
    // בונים מרכיבים מקומיים כדי שהבדיקה לא תלויה באזור זמן הרצה.
    expect(formatDate(new Date(2026, 8, 11))).toBe('11/09/2026');
  });

  it('מחזיר — לערך ריק', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('מחזיר — למחרוזת לא תקינה (בלי לזרוק)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(formatDate('not-a-date')).toBe('—');
  });
});

describe('money', () => {
  it('מעצב סכום עם סימן שקל ו-2 ספרות', () => {
    const out = money(1234.5);
    expect(out).toMatch(/1,234\.50/);
    expect(out).toContain('₪');
  });

  it('מחזיר — לערכים ריקים או לא-מספריים', () => {
    expect(money(null)).toBe('—');
    expect(money(undefined)).toBe('—');
    expect(money('')).toBe('—');
    expect(money('לא-מספר')).toBe('—');
    expect(money(Infinity)).toBe('—');
  });

  it('מקבל מחרוזת מספרית (numeric מהמסד)', () => {
    expect(money('1000.00')).toMatch(/1,000\.00/);
  });

  it('moneyRound ללא אגורות', () => {
    const out = moneyRound(1000.4);
    expect(out).toMatch(/1,000/);
    expect(out).not.toMatch(/\.\d/);
  });
});

describe('fmtSize', () => {
  it('ק״ב מתחת למגה, מ״ב מעל', () => {
    expect(fmtSize(2048)).toBe('2 ק״ב');
    expect(fmtSize(1048576)).toBe('1.0 מ״ב');
    expect(fmtSize(5 * 1048576)).toBe('5.0 מ״ב');
  });

  it('מחרוזת ריקה כשאין ערך', () => {
    expect(fmtSize(null)).toBe('');
    expect(fmtSize(undefined)).toBe('');
  });
});

describe('initials', () => {
  it('אות ראשונה משתי המילים הראשונות', () => {
    expect(initials('ישראל ישראלי')).toBe('יי');
    expect(initials('Madonna')).toBe('M');
    expect(initials('a b c d')).toBe('ab');
  });

  it('נקודה כברירת מחדל כשאין שם', () => {
    expect(initials(null)).toBe('·');
    expect(initials('')).toBe('·');
    expect(initials('   ')).toBe('·');
  });
});

describe('safeUrl', () => {
  it('מוסיף https לכתובת ללא סכמה', () => {
    expect(safeUrl('example.com')).toBe('https://example.com/');
  });

  it('שומר http/https קיימים', () => {
    expect(safeUrl('https://x.co/a')).toBe('https://x.co/a');
    expect(safeUrl('http://x.co')).toBe('http://x.co/');
  });

  it('חוסם סכמות מסוכנות ומחזיר null', () => {
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('data:text/html,x')).toBeNull();
    expect(safeUrl('ftp://x.co')).toBeNull();
  });

  it('null לערך ריק', () => {
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl('')).toBeNull();
    expect(safeUrl('   ')).toBeNull();
  });
});

describe('slugify', () => {
  it('אנגלית → אותיות קטנות עם מקפים וסיומת אקראית', () => {
    expect(slugify('Senior Developer')).toMatch(/^senior-developer-[a-z0-9]{5}$/);
  });

  it('שומר אותיות עבריות', () => {
    expect(slugify('מנהל משמרת')).toMatch(/^מנהל-משמרת-[a-z0-9]{5}$/);
  });

  it('נופל ל-job כשאין תווים תקינים', () => {
    expect(slugify('!!!')).toMatch(/^job-[a-z0-9]{5}$/);
  });
});

describe('safeFileName', () => {
  it('מנרמל שם + סיומת ל-ASCII', () => {
    expect(safeFileName('my file.PDF')).toBe('my-file.pdf');
  });

  it('שם לא-ASCII נופל ל-file עם שמירת סיומת', () => {
    expect(safeFileName('קורות חיים.docx')).toBe('file.docx');
  });

  it('בלי סיומת', () => {
    expect(safeFileName('resume')).toBe('resume');
  });
});

describe('label', () => {
  it('מחזיר תווית ידועה', () => {
    expect(label(JOB_STAGE, 'open')).toBe('פתוחה');
  });

  it('נופל לערך הגולמי כשהמפתח לא במפה', () => {
    expect(label(JOB_STAGE, 'unknown_stage')).toBe('unknown_stage');
  });

  it('— כשאין מפתח', () => {
    expect(label(JOB_STAGE, null)).toBe('—');
    expect(label(JOB_STAGE, undefined)).toBe('—');
  });
});
