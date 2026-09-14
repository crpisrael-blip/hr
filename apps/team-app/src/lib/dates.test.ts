import { describe, expect, it } from 'vitest';
import { currentMonthLocal, isValidDateString, monthStartIso, todayLocal } from './dates';

describe('todayLocal (שעון ישראל)', () => {
  it('מחזיר את התאריך המקומי בישראל', () => {
    expect(todayLocal(new Date('2026-09-11T10:00:00Z'))).toBe('2026-09-11');
  });

  it('אחרי חצות בישראל אך עדיין אתמול ב-UTC → היום המקומי', () => {
    // 22:30Z בקיץ = 01:30 למחרת בישראל (UTC+3).
    expect(todayLocal(new Date('2026-09-11T22:30:00Z'))).toBe('2026-09-12');
  });
});

describe('currentMonthLocal', () => {
  it('YYYY-MM לפי שעון ישראל', () => {
    expect(currentMonthLocal(new Date('2026-09-11T10:00:00Z'))).toBe('2026-09');
  });

  it('ליל ה-1 בחודש בישראל שהוא עדיין החודש הקודם ב-UTC', () => {
    // 31.8 22:30Z = 1.9 01:30 בישראל.
    expect(currentMonthLocal(new Date('2026-08-31T22:30:00Z'))).toBe('2026-09');
  });
});

describe('isValidDateString', () => {
  it('מקבל תאריך אמיתי בפורמט YYYY-MM-DD', () => {
    expect(isValidDateString('2026-09-11')).toBe(true);
  });

  it('דוחה תאריכים לא-קיימים', () => {
    expect(isValidDateString('2026-02-31')).toBe(false);
    expect(isValidDateString('2026-13-01')).toBe(false);
  });

  it('דוחה פורמט שגוי', () => {
    expect(isValidDateString('2026-9-1')).toBe(false);
    expect(isValidDateString('11/09/2026')).toBe(false);
    expect(isValidDateString('garbage')).toBe(false);
  });
});

describe('monthStartIso', () => {
  it('קיץ (DST, UTC+3): תחילת החודש בישראל כ-ISO', () => {
    expect(monthStartIso(new Date('2026-09-15T10:00:00Z'))).toBe('2026-08-31T21:00:00.000Z');
  });

  it('חורף (ללא DST, UTC+2)', () => {
    expect(monthStartIso(new Date('2026-01-15T10:00:00Z'))).toBe('2025-12-31T22:00:00.000Z');
  });
});
