// "היום" לפי שעון ישראל. new Date().toISOString() מחזיר UTC, ולכן בין חצות
// ל-03:00 שעון ישראל הוא מחזיר את אתמול (ובראשון לחודש — את החודש הקודם).

export const TZ = 'Asia/Jerusalem';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

/** תאריך היום בישראל בפורמט YYYY-MM-DD. */
export function todayLocal(d: Date = new Date()): string {
  return dateFmt.format(d); // en-CA מפיק YYYY-MM-DD
}

/** החודש הנוכחי בישראל בפורמט YYYY-MM. */
export function currentMonthLocal(d: Date = new Date()): string {
  return todayLocal(d).slice(0, 7);
}

/** תחילת החודש הנוכחי בישראל, כ-ISO מלא (לשאילתות gte). */
export function monthStartIso(d: Date = new Date()): string {
  const [y, m] = todayLocal(d).split('-').map(Number);
  // חצות ה-1 בחודש בישראל; ההיסט נגזר מהפרש היום המקומי ל-UTC.
  const guess = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0));
  const offsetMin = offsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60_000).toISOString();
}

function offsetMinutes(at: Date): number {
  // הפרש בדקות בין שעון ישראל ל-UTC בתאריך הנתון (2 או 3 שעות).
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(s.find(p => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** בדיקת מחרוזת תאריך YYYY-MM-DD אמיתית (לא 2026-02-31). */
export function isValidDateString(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
