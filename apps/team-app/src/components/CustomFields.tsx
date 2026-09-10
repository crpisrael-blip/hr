import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// שדות מותאמים ללא קוד. ההגדרות נטענות מ-app.custom_fields לפי סוג הישות,
// והערכים יושבים באובייקט custom של הישות. רכיב אחד לעריכה ורכיב לתצוגה.

export interface CustomField {
  id: string; entity_type: string; key: string; label: string; type: string;
  help?: string | null; required: boolean; options: { value: string; label: string }[]; sort: number; active: boolean;
}

export const CF_TYPES: [string, string][] = [
  ['text', 'טקסט קצר'], ['textarea', 'טקסט ארוך'], ['number', 'מספר'], ['date', 'תאריך'],
  ['boolean', 'כן/לא'], ['select', 'בחירה יחידה'], ['multiselect', 'בחירה מרובה'],
];

// טעינת הגדרות השדות הפעילים לסוג ישות.
export function useCustomFields(entityType: string) {
  const [fields, setFields] = useState<CustomField[]>([]);
  useEffect(() => {
    let alive = true;
    supabase.from('custom_fields').select('*').eq('entity_type', entityType).eq('active', true)
      .order('sort').then(r => { if (alive && !r.error) setFields(r.data as CustomField[]); });
    return () => { alive = false; };
  }, [entityType]);
  return fields;
}

type Vals = Record<string, any>;

// עריכה — נטמע בטופסי יצירה/עריכה. onChange מחזיר את אובייקט הערכים המלא.
export function CustomFieldsEdit({ entityType, values, onChange, title = 'שדות נוספים' }:
  { entityType: string; values: Vals | null | undefined; onChange: (v: Vals) => void; title?: string }) {
  const fields = useCustomFields(entityType);
  if (!fields.length) return null;
  const vals = values ?? {};
  const set = (k: string, v: any) => onChange({ ...vals, [k]: v });

  return (
    <div className="card" style={{ padding: 18, display: 'grid', gap: 12 }}>
      <h2 className="sec" style={{ margin: 0, fontSize: '1.02rem' }}>{title}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {fields.map(f => <CFEditOne key={f.id} f={f} value={vals[f.key]} onChange={v => set(f.key, v)} />)}
      </div>
    </div>
  );
}

function CFEditOne({ f, value, onChange }: { f: CustomField; value: any; onChange: (v: any) => void }) {
  const label = <span className="lbl">{f.label}{f.required && <span style={{ color: 'var(--warn)' }}> *</span>}</span>;
  const help = f.help ? <span className="hint">{f.help}</span> : null;
  switch (f.type) {
    case 'textarea':
      return <label style={{ gridColumn: '1 / -1' }}>{label}<textarea rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'number':
      return <label>{label}<input type="number" dir="ltr" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'date':
      return <label>{label}<input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'boolean':
      return <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />{label}</label>;
    case 'select':
      return <label>{label}<select value={value ?? ''} onChange={e => onChange(e.target.value)}>
        <option value="">בחרו…</option>{f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>{help}</label>;
    case 'multiselect': {
      const arr: string[] = Array.isArray(value) ? value : [];
      return <div style={{ gridColumn: '1 / -1' }}>{label}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          {f.options.map(o => <label key={o.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={arr.includes(o.value)} style={{ width: 16, height: 16 }}
              onChange={e => onChange(e.target.checked ? [...arr, o.value] : arr.filter(x => x !== o.value))} /><span>{o.label}</span></label>)}
        </div>{help}</div>;
    }
    default:
      return <label>{label}<input value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
  }
}

// תצוגה — נטמע בכרטיסים. מציג רק שדות שיש להם ערך.
export function CustomFieldsView({ entityType, values, title = 'שדות נוספים' }:
  { entityType: string; values: Vals | null | undefined; title?: string }) {
  const fields = useCustomFields(entityType);
  const vals = values ?? {};
  const shown = fields.filter(f => { const v = vals[f.key]; return v != null && v !== '' && !(Array.isArray(v) && !v.length); });
  if (!shown.length) return null;
  const disp = (f: CustomField, v: any) => Array.isArray(v) ? v.join(', ') : f.type === 'boolean' ? (v ? 'כן' : 'לא') : String(v);
  return (
    <div className="card" style={{ padding: 18 }}>
      <h2 className="sec" style={{ margin: '0 0 10px', fontSize: '1.02rem' }}>{title}</h2>
      <dl className="cf-dl">
        {shown.map(f => <div key={f.id} style={{ display: 'contents' }}><dt>{f.label}</dt><dd>{disp(f, vals[f.key])}</dd></div>)}
      </dl>
      <style>{`.cf-dl{display:grid;grid-template-columns:150px 1fr;gap:8px 12px;margin:0}.cf-dl dt{color:var(--ink-soft);font-size:.88rem}.cf-dl dd{margin:0}`}</style>
    </div>
  );
}
