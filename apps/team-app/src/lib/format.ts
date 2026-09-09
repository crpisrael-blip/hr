export function formatDate(v: string | null): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(v));
}
export function money(v: number | null, currency = 'ILS'): string {
  if (v == null) return '—';
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(v);
}
export function slugify(title: string): string {
  const base = title.trim().toLowerCase()
    .replace(/["'׳״]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base || 'job'}-${rand}`;
}

export const COMPANY_STATUS: Record<string, string> = {
  lead: 'ליד', active: 'פעילה', on_hold: 'בהמתנה', inactive: 'לא פעילה',
};
export const JOB_STAGE: Record<string, string> = {
  draft: 'טיוטה', open: 'פתוחה', on_hold: 'בהמתנה', filled: 'אוישה', closed: 'סגורה',
};
export const APP_STAGE: Record<string, string> = {
  new: 'חדש', screening: 'בבדיקה', initial_call: 'שיחה ראשונית',
  submitted_to_client: 'הוגש ללקוח', interview: 'ראיון', offer: 'הצעה', hired: 'התקבל',
  rejected: 'נדחה', withdrawn: 'הסיר מועמדות', job_cancelled: 'משרה בוטלה',
};
export const SCOPE: Record<string, string> = {
  full_time: 'מלאה', part_time: 'חלקית', temporary: 'זמני', contract: 'חוזה', student: 'סטודנט',
};

export const COMMISSION_BASE: Record<string, string> = { monthly: 'חודשי', annual: 'שנתי' };
export const PLACEMENT_STATUS: Record<string, string> = {
  pending_start: 'ממתין לתחילת עבודה', working_warranty: 'בתקופת אחריות', approved: 'מאושרת',
  not_started: 'לא התחיל', left_in_warranty: 'עזב בתקופת האחריות', cancelled: 'בוטלה',
};
export const INVOICE_STATUS: Record<string, string> = {
  planned: 'מתוכנן', issued: 'הופק', partially_paid: 'שולם חלקית', paid: 'שולם', cancelled: 'בוטל', credited: 'זוכה',
};
