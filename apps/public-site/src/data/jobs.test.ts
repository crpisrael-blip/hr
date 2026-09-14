import { describe, expect, it } from 'vitest';
import {
  type Job,
  SCOPE_LABEL,
  excerpt,
  isFresh,
  isRemoteLocation,
  isoDate,
  locationsOf,
  validThrough,
} from './jobs';

const job = (over: Partial<Job> = {}): Job => ({
  slug: 'slug',
  title: 'תפקיד',
  body: 'תיאור',
  location: 'תל אביב',
  employment_scope: 'full_time',
  company_name: 'חברה',
  published_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('isRemoteLocation', () => {
  it('מזהה עבודה מרחוק/היברידית', () => {
    expect(isRemoteLocation('עבודה מרחוק')).toBe(true);
    expect(isRemoteLocation('משרה היברידית')).toBe(true);
    expect(isRemoteLocation('Hybrid role')).toBe(true);
  });

  it('יישוב רגיל אינו "מרחוק"', () => {
    expect(isRemoteLocation('תל אביב')).toBe(false);
    expect(isRemoteLocation(null)).toBe(false);
  });
});

describe('isFresh', () => {
  it('משרה שפורסמה עכשיו היא טרייה', () => {
    expect(isFresh(job({ published_at: new Date().toISOString() }))).toBe(true);
  });

  it('משרה מלפני 30 יום אינה טרייה (סף ברירת מחדל 14)', () => {
    const old = new Date(Date.now() - 30 * 864e5).toISOString();
    expect(isFresh(job({ published_at: old }))).toBe(false);
  });

  it('מכבד סף ימים מותאם', () => {
    const d = new Date(Date.now() - 20 * 864e5).toISOString();
    expect(isFresh(job({ published_at: d }), 30)).toBe(true);
  });
});

describe('validThrough', () => {
  it('מוסיף 90 יום כברירת מחדל', () => {
    expect(validThrough('2026-01-01T00:00:00.000Z')).toBe('2026-04-01T00:00:00.000Z');
  });

  it('מכבד חלון ימים מותאם', () => {
    expect(validThrough('2026-01-01T00:00:00.000Z', 10)).toBe('2026-01-11T00:00:00.000Z');
  });
});

describe('isoDate', () => {
  it('גוזר את חלק התאריך בלבד', () => {
    expect(isoDate('2026-09-11T10:30:00.000Z')).toBe('2026-09-11');
  });
});

describe('excerpt', () => {
  it('מחזיר טקסט קצר כמות שהוא', () => {
    expect(excerpt('טקסט קצר')).toBe('טקסט קצר');
  });

  it('משטח תבליטים, ירידות שורה ורווחים כפולים', () => {
    expect(excerpt('שורה\n\nעוד • פריט')).toBe('שורה עוד פריט');
  });

  it('חותך טקסט ארוך בגבול מילה ומוסיף שלוש נקודות', () => {
    const long = Array(60).fill('מילה').join(' ');
    const out = excerpt(long, 50);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out).not.toContain('  ');
  });

  it('עמיד מול גוף ריק/undefined', () => {
    expect(excerpt('')).toBe('');
    expect(excerpt(undefined as unknown as string)).toBe('');
  });
});

describe('locationsOf', () => {
  it('רשימת מיקומים ייחודית וממוינת, ללא ריקים', () => {
    const jobs = [
      job({ location: 'תל אביב' }),
      job({ location: 'חיפה' }),
      job({ location: 'תל אביב' }),
      job({ location: null }),
    ];
    expect(locationsOf(jobs)).toEqual(['חיפה', 'תל אביב']);
  });

  it('מערך ריק כשאין מיקומים', () => {
    expect(locationsOf([job({ location: null })])).toEqual([]);
  });
});

describe('SCOPE_LABEL', () => {
  it('תוויות עבריות להיקפי משרה', () => {
    expect(SCOPE_LABEL.full_time).toBe('משרה מלאה');
    expect(SCOPE_LABEL.student).toBe('משרת סטודנט');
  });
});
