// תצורת סביבה. ערכים שנבדלים בין סביבות לא נשארים קשיחים בקוד.

/** בסיס הקישור לטופס שנשלח לנמען (האזור האישי). */
export const FORM_BASE: string =
  (import.meta.env.VITE_FORM_BASE as string | undefined)?.replace(/\/+$/, '')
  || 'https://my.hr.ort-tech.co.il';

/** תקרת שורות אחידה לרשימות; מעליה מוצג "הצגת עוד". */
export const PAGE_SIZE = 100;

/** מגבלות העלאת מסמכי עובד. */
export const MAX_UPLOAD_MB = 10;
export const ALLOWED_UPLOAD_MIME = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png',
];
export const ALLOWED_UPLOAD_ACCEPT = '.pdf,.docx,.jpg,.jpeg,.png';
