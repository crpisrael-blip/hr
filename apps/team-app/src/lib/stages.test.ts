import { describe, expect, it } from 'vitest';
import { allowedTransitions, isTerminal } from './stages';

describe('isTerminal', () => {
  it('מזהה שלבים סופיים', () => {
    expect(isTerminal('rejected')).toBe(true);
    expect(isTerminal('withdrawn')).toBe(true);
    expect(isTerminal('job_cancelled')).toBe(true);
  });

  it('שלבי עבודה אינם סופיים', () => {
    expect(isTerminal('new')).toBe(false);
    expect(isTerminal('hired')).toBe(false);
  });
});

describe('allowedTransitions', () => {
  it('משלב עבודה: קידום לשלב הבא + שתי סגירות', () => {
    const out = allowedTransitions('new');
    expect(out.map(t => t.to)).toEqual(['screening', 'rejected', 'withdrawn']);
    expect(out[0].kind).toBe('advance');
    expect(out[1].kind).toBe('close');
    expect(out[2].kind).toBe('close');
  });

  it('offer מקדם ל-hired', () => {
    const out = allowedTransitions('offer');
    expect(out[0]).toMatchObject({ to: 'hired', kind: 'advance' });
    expect(out).toHaveLength(3);
  });

  it('hired הוא סוף המסלול: אין קידום ואין סגירה', () => {
    expect(allowedTransitions('hired')).toEqual([]);
  });

  it('שלב סופי מאפשר רק פתיחה מחדש ל-screening', () => {
    const out = allowedTransitions('rejected');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ to: 'screening', kind: 'reopen' });
  });

  it('שלב לא מוכר: בלי קידום, עם שתי סגירות בלבד', () => {
    const out = allowedTransitions('bogus');
    expect(out.map(t => t.to)).toEqual(['rejected', 'withdrawn']);
  });
});
