import type { RenderField } from '../lib/formLayout';
import { SCOPE } from '../lib/format';

// רינדור שדה בודד לפי ה-widget שלו. ערכי חברה/היקף הם widgets ייעודיים;
// השאר מקבילים לסוגי השדות המותאמים.
export default function FieldInput({ field, value, onChange, companies }:
  { field: RenderField; value: any; onChange: (v: any) => void; companies?: { id: string; name: string }[] }) {
  const lbl = <span className="lbl">{field.label}{field.required && <span style={{ color: 'var(--warn)' }}> *</span>}</span>;
  const help = field.help ? <span className="hint">{field.help}</span> : null;

  switch (field.widget) {
    case 'company':
      return <label>{lbl}
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required}>
          <option value="">בחרו חברה…</option>
          {(companies ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>;
    case 'scope':
      return <label>{lbl}
        <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">—</option>
          {Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>;
    case 'textarea':
      return <label>{lbl}<textarea value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />{help}</label>;
    case 'number':
      return <label>{lbl}<input type="number" dir="ltr" value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />{help}</label>;
    case 'date':
      return <label>{lbl}<input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />{help}</label>;
    case 'boolean':
      return <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ width: 18, height: 18 }} />{lbl}</label>;
    case 'select':
      return <label>{lbl}
        <select value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required}>
          <option value="">בחרו…</option>{(field.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>{help}</label>;
    case 'multiselect': {
      const arr: string[] = Array.isArray(value) ? value : [];
      return <div>{lbl}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
          {(field.options ?? []).map(o => <label key={o.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={arr.includes(o.value)} style={{ width: 16, height: 16 }}
              onChange={e => onChange(e.target.checked ? [...arr, o.value] : arr.filter(x => x !== o.value))} /><span>{o.label}</span></label>)}
        </div>{help}</div>;
    }
    default:
      return <label>{lbl}<input value={value ?? ''} onChange={e => onChange(e.target.value)} required={field.required} />{help}</label>;
  }
}
