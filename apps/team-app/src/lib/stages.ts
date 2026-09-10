import { APP_STAGE } from './format';

// שלבי עבודה לפי סדר, מתוך תרחיש 2 באפיון.
export const WORK_ORDER = [
  'new', 'screening', 'initial_call', 'submitted_to_client', 'interview', 'offer', 'hired',
] as const;
export const TERMINAL = ['rejected', 'withdrawn', 'job_cancelled'] as const;

export type Stage = typeof WORK_ORDER[number] | typeof TERMINAL[number];

export function isTerminal(s: string): boolean {
  return (TERMINAL as readonly string[]).includes(s);
}

/** מעברים מותרים מהשלב הנוכחי, לפי כללי האפיון. */
export function allowedTransitions(current: string): { to: Stage; label: string; kind: 'advance' | 'close' | 'reopen' }[] {
  const out: { to: Stage; label: string; kind: 'advance' | 'close' | 'reopen' }[] = [];
  const i = (WORK_ORDER as readonly string[]).indexOf(current);

  if (isTerminal(current)) {
    // פתיחה מחדש, בסמכות ראש צוות/מנהלת.
    out.push({ to: 'screening', label: 'פתיחה מחדש', kind: 'reopen' });
    return out;
  }
  // קידום לשלב הבא
  if (i >= 0 && i < WORK_ORDER.length - 1) {
    const next = WORK_ORDER[i + 1];
    out.push({ to: next, label: `קידום ל"${APP_STAGE[next]}"`, kind: 'advance' });
  }
  // סגירה, מכל שלב עבודה שאינו התקבל
  if (current !== 'hired') {
    out.push({ to: 'rejected', label: 'נדחה', kind: 'close' });
    out.push({ to: 'withdrawn', label: 'הסיר מועמדות', kind: 'close' });
  }
  return out;
}
