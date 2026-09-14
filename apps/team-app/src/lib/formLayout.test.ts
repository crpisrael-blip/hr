import { describe, expect, it, vi } from 'vitest';

// formLayout.ts מייבא את לקוח Supabase ברמת המודול. הבדיקות כאן נוגעות רק
// בלוגיקת המיזוג הטהורה (effectiveFields/fieldsToSlots), ולכן ממקּים את המודול
// כדי לא לטעון לקוח אמיתי.
vi.mock('./supabase', () => ({ supabase: {} }));

import type { CustomField } from '../components/CustomFields';
import { JOB_BUILTINS, effectiveFields, fieldsToSlots, type Slot } from './formLayout';

const cf = (over: Partial<CustomField> & { key: string }): CustomField => ({
  id: over.key,
  entity_type: 'job',
  label: over.key,
  type: 'text',
  required: false,
  options: [],
  sort: 0,
  active: true,
  ...over,
});

describe('effectiveFields', () => {
  it('בלי פריסה ובלי מותאמים → כל המובנים בסדר ברירת המחדל', () => {
    const out = effectiveFields(JOB_BUILTINS, [], []);
    expect(out).toHaveLength(JOB_BUILTINS.length);
    expect(out[0]).toMatchObject({ ref: 'builtin:company_id', locked: true, hidden: false });
    expect(out.every(f => f.kind === 'builtin')).toBe(true);
  });

  it('slots קובעים סדר; מובנים שלא הוזכרו נספחים בסוף לפי הרישום', () => {
    const slots: Slot[] = [{ ref: 'builtin:title' }, { ref: 'builtin:company_id' }];
    const out = effectiveFields(JOB_BUILTINS, [], slots);
    expect(out[0].ref).toBe('builtin:title');
    expect(out[1].ref).toBe('builtin:company_id');
    expect(out).toHaveLength(JOB_BUILTINS.length); // בלי כפילויות
    expect(new Set(out.map(f => f.ref)).size).toBe(out.length);
  });

  it('דריסת תווית ורוחב על שדה מובנה', () => {
    const out = effectiveFields(JOB_BUILTINS, [], [{ ref: 'builtin:location', label: 'עיר', width: 'full' }]);
    const loc = out.find(f => f.ref === 'builtin:location')!;
    expect(loc.label).toBe('עיר');
    expect(loc.width).toBe('full');
  });

  it('שדה נעול נשאר גלוי גם כשהפריסה מבקשת להסתיר', () => {
    const out = effectiveFields(JOB_BUILTINS, [], [{ ref: 'builtin:company_id', hidden: true }]);
    expect(out.find(f => f.ref === 'builtin:company_id')!.hidden).toBe(false);
  });

  it('שדה לא-נעול ניתן להסתרה', () => {
    const out = effectiveFields(JOB_BUILTINS, [], [{ ref: 'builtin:location', hidden: true }]);
    expect(out.find(f => f.ref === 'builtin:location')!.hidden).toBe(true);
  });

  it('שדות מותאמים נספחים בסוף כ-custom', () => {
    const out = effectiveFields(JOB_BUILTINS, [cf({ key: 'k1', label: 'נוסף' })], []);
    expect(out).toHaveLength(JOB_BUILTINS.length + 1);
    const last = out[out.length - 1];
    expect(last).toMatchObject({ ref: 'custom:k1', kind: 'custom', cfKey: 'k1', label: 'נוסף' });
  });

  it('מתעלם מ-slot שמפנה ל-ref לא-קיים', () => {
    const out = effectiveFields(JOB_BUILTINS, [], [{ ref: 'builtin:nonexistent' }, { ref: 'custom:ghost' }]);
    expect(out).toHaveLength(JOB_BUILTINS.length);
    expect(out.some(f => f.ref === 'builtin:nonexistent')).toBe(false);
  });
});

describe('fieldsToSlots (materializing)', () => {
  it('ברירת מחדל נקייה → slots עם ref בלבד (בלי דריסות)', () => {
    const fields = effectiveFields(JOB_BUILTINS, [], []);
    const slots = fieldsToSlots(fields, JOB_BUILTINS);
    expect(slots).toHaveLength(JOB_BUILTINS.length);
    expect(slots.every(s => Object.keys(s).length === 1 && 'ref' in s)).toBe(true);
  });

  it('שומר רק דריסות שונות מברירת המחדל', () => {
    const fields = effectiveFields(JOB_BUILTINS, [], [
      { ref: 'builtin:location', label: 'עיר', hidden: true },
    ]);
    const slots = fieldsToSlots(fields, JOB_BUILTINS);
    const loc = slots.find(s => s.ref === 'builtin:location')!;
    expect(loc).toMatchObject({ ref: 'builtin:location', label: 'עיר', hidden: true });
    // company_id ללא שינוי → ref בלבד
    const company = slots.find(s => s.ref === 'builtin:company_id')!;
    expect(Object.keys(company)).toEqual(['ref']);
  });

  it('סבב הלוך-ושוב שומר על הסדר', () => {
    const reordered: Slot[] = [{ ref: 'builtin:title' }, { ref: 'builtin:company_id' }];
    const fields = effectiveFields(JOB_BUILTINS, [], reordered);
    const slots = fieldsToSlots(fields, JOB_BUILTINS);
    expect(slots.slice(0, 2).map(s => s.ref)).toEqual(['builtin:title', 'builtin:company_id']);
  });
});
