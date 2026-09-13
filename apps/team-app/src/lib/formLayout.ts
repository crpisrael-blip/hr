// בנאי טפסים — מודל הפריסה. שדה מובנה קשור לעמודה במסד; שדה מותאם יושב ב-custom.
// הפריסה (סדר/הסתרה/תווית/רוחב) נשמרת ב-app.form_layouts כמערך slots לפי סדר.
// אין שורה = ברירת המחדל שבקוד (JOB_BUILTINS) ואחריה השדות המותאמים.
import { supabase } from './supabase';
import type { CustomField } from '../components/CustomFields';

export type FieldWidget =
  | 'text' | 'textarea' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect'
  | 'company' | 'scope';
export type FieldWidth = 'full' | 'half' | 'third';

export interface BuiltinField {
  column: string;        // עמודת המסד
  label: string;         // תווית ברירת מחדל
  widget: FieldWidget;
  required?: boolean;    // חובה (מוצג עם *)
  locked?: boolean;      // חובה במסד ללא ברירת מחדל — אי אפשר להסתיר/למחוק
  width?: FieldWidth;
}

// slot בפריסה: הפניה לשדה מובנה או מותאם, עם דריסות אופציונליות.
export interface Slot { ref: string; label?: string; hidden?: boolean; width?: FieldWidth }

// שדה מוכן לרינדור אחרי מיזוג רישום + מותאמים + פריסה.
export interface RenderField {
  ref: string; kind: 'builtin' | 'custom';
  column?: string; cfKey?: string;
  label: string; widget: FieldWidget;
  required: boolean; locked: boolean; hidden: boolean; width: FieldWidth;
  options?: { value: string; label: string }[]; help?: string | null;
}

// רישום השדות המובנים של טופס המשרה, בסדר ברירת המחדל.
// company_id ו-title הם NOT NULL ללא ברירת מחדל — לכן locked.
export const JOB_BUILTINS: BuiltinField[] = [
  { column: 'company_id',           label: 'חברה',        widget: 'company',  required: true, locked: true, width: 'full' },
  { column: 'title',                label: 'תפקיד',       widget: 'text',     required: true, locked: true, width: 'full' },
  { column: 'internal_description', label: 'תיאור פנימי', widget: 'textarea', width: 'full' },
  { column: 'location',             label: 'מיקום',       widget: 'text',     width: 'half' },
  { column: 'employment_scope',     label: 'היקף',        widget: 'scope',    width: 'half' },
  { column: 'headcount',            label: 'תקנים',       widget: 'number',   width: 'third' },
  { column: 'salary_min',           label: 'שכר מ־',      widget: 'number',   width: 'third' },
  { column: 'salary_max',           label: 'שכר עד',      widget: 'number',   width: 'third' },
];

const refBuiltin = (b: BuiltinField) => 'builtin:' + b.column;
const refCustom = (c: CustomField) => 'custom:' + c.key;

/** מיזוג רישום מובנים + שדות מותאמים + slots שמורים → רשימת שדות מסודרת. */
export function effectiveFields(builtins: BuiltinField[], custom: CustomField[], slots: Slot[]): RenderField[] {
  const byBuiltin = new Map(builtins.map(b => [refBuiltin(b), b]));
  const byCustom = new Map(custom.map(c => [refCustom(c), c]));
  const out: RenderField[] = [];
  const seen = new Set<string>();

  const add = (ref: string, slot?: Slot) => {
    if (seen.has(ref)) return;
    const b = byBuiltin.get(ref);
    if (b) {
      seen.add(ref);
      out.push({
        ref, kind: 'builtin', column: b.column, label: slot?.label || b.label, widget: b.widget,
        required: !!b.required, locked: !!b.locked,
        hidden: b.locked ? false : !!slot?.hidden,       // נעול תמיד גלוי
        width: slot?.width || b.width || 'full',
      });
      return;
    }
    const c = byCustom.get(ref);
    if (c) {
      seen.add(ref);
      out.push({
        ref, kind: 'custom', cfKey: c.key, label: slot?.label || c.label, widget: c.type as FieldWidget,
        required: c.required, locked: false, hidden: !!slot?.hidden,
        width: slot?.width || 'full', options: c.options, help: c.help,
      });
    }
  };

  for (const s of slots) add(s.ref, s);          // סדר לפי הפריסה
  for (const b of builtins) add(refBuiltin(b));   // מובנים שלא הוזכרו — בסוף, לפי הרישום
  for (const c of custom) add(refCustom(c));       // מותאמים שלא הוזכרו — בסוף, לפי sort
  return out;
}

/** materializing: הופך רשימה מסודרת ל-slots לשמירה (כולל הסתרה/תווית/רוחב). */
export function fieldsToSlots(fields: RenderField[], builtins: BuiltinField[]): Slot[] {
  const defLabel = new Map(builtins.map(b => [refBuiltin(b), b.label]));
  const defWidth = new Map(builtins.map(b => [refBuiltin(b), b.width || 'full']));
  return fields.map(f => {
    const slot: Slot = { ref: f.ref };
    // תווית נשמרת רק כדריסה (שונה מברירת המחדל של מובנה; לכל מותאם נשמרת כדי שסדר יישמר).
    if (f.kind === 'builtin') {
      if (f.label !== defLabel.get(f.ref)) slot.label = f.label;
      if (f.width !== (defWidth.get(f.ref) as FieldWidth)) slot.width = f.width;
      if (f.hidden) slot.hidden = true;
    } else {
      if (f.width !== 'full') slot.width = f.width;
      if (f.hidden) slot.hidden = true;
      // תווית של מותאם מנוהלת ב-custom_fields עצמו; לא נשמרת כאן.
    }
    return slot;
  });
}

export async function loadLayout(entityType: string): Promise<Slot[]> {
  const r = await supabase.from('form_layouts').select('slots').eq('entity_type', entityType).maybeSingle();
  if (r.error || !r.data) return [];
  return (r.data.slots as Slot[]) ?? [];
}

export async function saveLayout(entityType: string, slots: Slot[], updatedBy?: string | null): Promise<{ error: unknown }> {
  const { error } = await supabase.from('form_layouts')
    .upsert({ entity_type: entityType, slots, updated_by: updatedBy ?? null }, { onConflict: 'entity_type' });
  return { error };
}
