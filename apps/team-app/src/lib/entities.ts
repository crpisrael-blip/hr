// מקור אמת יחיד לסוגי הישויות במערכת ולקטגוריות התיוק.
// כל מודול הטפסים (ומודולים עתידיים) נגזר מכאן — הוספת סוג ישות חדש כאן
// מופיעה אוטומטית בכל המקומות הרלוונטיים: "מיועד ל", "יעד תיוק", מיפוי
// לשדות המערכת, וקישור בשליחה. אין לשכפל רשימות קשיחות במסכים.

export interface EntityColumn { col: string; label: string }

export interface EntityType {
  key: string;          // מזהה הסוג (נשמר ב-form_instances.entity_type / form_templates.filing_target)
  label: string;        // תווית בעברית
  table: string;        // טבלת המסד
  nameCol: string | null; // עמודת השם להצגה/חיפוש (null = לא ניתן לחיפוש ישיר)
  recipient?: string;   // אם הסוג יכול לקבל טופס — מזהה ה"מיועד ל" (candidate/staff/client)
  filing?: boolean;     // יכול לשמש כיעד תיוק
  mappable?: boolean;   // ניתן למפות אליו שדות (עדכון עמודות)
  linkable?: boolean;   // ניתן לבחור/לחפש בעת שליחה
  columns?: EntityColumn[]; // עמודות שמותר למפות אליהן תשובות מהטופס (עם תווית בעברית)
  customFields?: boolean; // תומך בשדות מותאמים ללא קוד (custom_fields + עמודת custom)
}

// ★ להוספת סוג ישות חדש — מוסיפים כאן שורה אחת בלבד.
// עמודות המיפוי (columns) תואמות לשמות העמודות בפועל במסד (schema app).
export const ENTITIES: EntityType[] = [
  { key: 'job',         label: 'משרה',         table: 'jobs',        nameCol: 'title',     customFields: true },
  { key: 'candidate',   label: 'מועמד',       table: 'candidates',  nameCol: 'full_name', recipient: 'candidate', filing: true, mappable: true, linkable: true, customFields: true,
    columns: [
      { col: 'full_name',        label: 'שם מלא' },
      { col: 'phone_raw',        label: 'טלפון' },
      { col: 'email',            label: 'דוא״ל' },
      { col: 'years_experience', label: 'שנות ניסיון' },
      { col: 'desired_salary',   label: 'שכר מבוקש' },
      { col: 'availability',     label: 'זמינות' },
      { col: 'source',           label: 'מקור' },
      { col: 'skills',           label: 'כישורים (רשימה)' },
    ] },
  // ★ אבטחה: employees אינה mappable בכוונה. מיפוי שדות מאפשר לכל עורך טופס
  // לקבוע טבלה+עמודה שתשובה מהטופס תדרוס — ורשומת עובד נושאת role/employment_status/user_id.
  // מיפוי לעובדים ייפתח רק כשתהיה אכיפה בצד השרת על העמודות המותרות.
  { key: 'employee',    label: 'עובד / מגייס', table: 'employees',   nameCol: 'full_name', recipient: 'staff',     filing: true, linkable: true, customFields: true },
  { key: 'company',     label: 'לקוח',         table: 'companies',   nameCol: 'name',      recipient: 'client',    filing: true, mappable: true, linkable: true, customFields: true,
    columns: [
      { col: 'name',        label: 'שם החברה' },
      { col: 'business_id', label: 'ח״פ / עוסק' },
      { col: 'website',     label: 'אתר' },
      { col: 'notes',       label: 'הערות' },
    ] },
  { key: 'application', label: 'מועמדות',      table: 'applications', nameCol: null,        filing: true, customFields: true },
  { key: 'placement',   label: 'השמה',         table: 'placements',  nameCol: null,        filing: true, customFields: true },
];

// "מיועד ל" — כללי + כל סוג שיכול לקבל טופס. נגזר מהרجיסטרי.
export const RECIPIENTS: { key: string; label: string }[] = [
  ...ENTITIES.filter(e => e.recipient).map(e => ({ key: e.recipient!, label: e.label })),
  { key: 'general', label: 'כללי' },
];
export const RECIPIENT_LABEL: Record<string, string> =
  Object.fromEntries(RECIPIENTS.map(r => [r.key, r.label]));

// יעדי תיוק — כל סוג עם filing + מאגר כללי.
export const FILING_TARGETS: { key: string; label: string }[] = [
  ...ENTITIES.filter(e => e.filing).map(e => ({ key: e.key, label: e.label })),
  { key: 'general', label: 'מאגר כללי' },
];

// סוגים שאליהם ניתן לקשר בעת שליחה (עם חיפוש).
export const LINKABLE = ENTITIES.filter(e => e.linkable);
// סוגים שאליהם ניתן למפות שדות.
export const MAPPABLE = ENTITIES.filter(e => e.mappable);

// סוגי ישות שתומכים בשדות מותאמים ללא קוד.
export const CUSTOM_FIELD_ENTITIES = ENTITIES.filter(e => e.customFields);

// ישויות שניתן לקשר אליהן משימה (תואם ל-enum app.linked_entity).
export const TASK_LINK_ENTITIES = ['candidate', 'company', 'job', 'application', 'placement', 'contact'] as const;
export const isTaskLinkEntity = (v?: string | null): v is typeof TASK_LINK_ENTITIES[number] =>
  !!v && (TASK_LINK_ENTITIES as readonly string[]).includes(v);

export const entityByKey = (k?: string | null) => ENTITIES.find(e => e.key === k) || null;
export const tableForEntity = (k?: string | null) => entityByKey(k)?.table ?? null;
export const entityByTable = (t?: string | null) => ENTITIES.find(e => e.table === t) || null;
// עמודות שמותר למפות אליהן לפי שם הטבלה (לרשימת בחירה בבנאי הטפסים).
export const columnsForTable = (t?: string | null): EntityColumn[] => entityByTable(t)?.columns ?? [];
/** האם מותר לכתוב מטופס לעמודה הזו — נבדק גם בצד הלקוח לפני עדכון. */
export const isMappableColumn = (table?: string | null, column?: string | null): boolean => {
  const en = entityByTable(table);
  return !!en?.mappable && !!column && (en.columns ?? []).some(c => c.col === column);
};

// קטגוריות תיוק/גיוס — רשימה מרכזית. מוצגות כהצעות (עם אפשרות טקסט חופשי).
export const FORM_CATEGORIES: string[] = [
  'מסמכי מועמד', 'קליטה', 'ראיון', 'העסקה', 'אישורים', 'משוב', 'הצהרות', 'שכר', 'כללי',
];
