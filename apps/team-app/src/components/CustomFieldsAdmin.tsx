import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { CUSTOM_FIELD_ENTITIES } from '../lib/entities';
import { CF_TYPES, type CustomField } from './CustomFields';

// ניהול שדות מותאמים למנהלת: בחירת סוג ישות והוספה/עריכה/מחיקה של שדות.
const hasOptions = (t: string) => t === 'select' || t === 'multiselect';
const newKey = () => 'cf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// entity קבוע (מהעורך ה-inline בטופס) נועל את הסוג ומסתיר את הבורר;
// בלעדיו (הגדרות) הבורר מוצג ומאפשר מעבר בין הסוגים.
export default function CustomFieldsAdmin({ entity: fixed }: { entity?: string } = {}) {
  const [picked, setPicked] = useState(CUSTOM_FIELD_ENTITIES[0]?.key ?? 'candidate');
  const entity = fixed ?? picked;
  const [rows, setRows] = useState<CustomField[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    const r = await supabase.from('custom_fields').select('*').eq('entity_type', entity).order('sort');
    if (r.error) setErr(r.error.message); else { setErr(''); setRows(r.data as CustomField[]); }
  }
  useEffect(() => { load(); }, [entity]);

  async function add() {
    const sort = rows.length ? Math.max(...rows.map(r => r.sort)) + 1 : 0;
    const { error } = await supabase.from('custom_fields').insert({ entity_type: entity, key: newKey(), label: 'שדה חדש', type: 'text', sort });
    if (error) setErr(error.message); else load();
  }
  async function patch(id: string, p: Partial<CustomField>) {
    const { error } = await supabase.from('custom_fields').update(p).eq('id', id);
    if (error) setErr(error.message); else load();
  }
  async function del(id: string) {
    if (!confirm('למחוק את השדה? ערכים שכבר נשמרו בישויות יישארו במסד אך לא יוצגו.')) return;
    const { error } = await supabase.from('custom_fields').delete().eq('id', id);
    if (error) setErr(error.message); else load();
  }
  async function move(i: number, d: number) {
    const j = i + d; if (j < 0 || j >= rows.length) return;
    const a = rows[i], b = rows[j];
    await supabase.from('custom_fields').update({ sort: b.sort }).eq('id', a.id);
    await supabase.from('custom_fields').update({ sort: a.sort }).eq('id', b.id);
    load();
  }

  return (
    <div className="card" style={{ padding: 18, display: 'grid', gap: 14 }}>
      <div className="spread">
        {fixed ? <span /> : (
          <label style={{ maxWidth: 260 }}><span className="lbl">סוג ישות</span>
            <select value={picked} onChange={e => setPicked(e.target.value)}>
              {CUSTOM_FIELD_ENTITIES.map(en => <option key={en.key} value={en.key}>{en.label}</option>)}
            </select></label>
        )}
        <button type="button" className="btn btn-quiet btn-sm" onClick={add}>+ שדה</button>
      </div>
      {err && <p className="msg err">{err}</p>}
      <p className="hint">השדות שתגדירו כאן יופיעו בכרטיס ובטופס העריכה של הישות שנבחרה — בלי צורך במפתח.</p>

      {rows.length === 0 ? <p className="hint">אין עדיין שדות מותאמים לסוג זה.</p> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {rows.map((f, i) => (
            <div key={f.id} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 10, alignItems: 'end' }}>
                <label><span className="lbl">שם השדה</span><input defaultValue={f.label} onBlur={e => e.target.value !== f.label && patch(f.id, { label: e.target.value })} /></label>
                <label><span className="lbl">סוג</span><select value={f.type} onChange={e => patch(f.id, { type: e.target.value })}>{CF_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => move(i, -1)} title="למעלה">↑</button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => move(i, 1)} title="למטה">↓</button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => del(f.id)} title="מחיקה">🗑</button>
                </div>
              </div>
              <label><span className="lbl">הסבר (רשות)</span><input defaultValue={f.help ?? ''} onBlur={e => (e.target.value || null) !== (f.help ?? null) && patch(f.id, { help: e.target.value || null })} /></label>
              {hasOptions(f.type) && (
                <label><span className="lbl">אפשרויות (שורה לכל אפשרות)</span>
                  <textarea rows={3} defaultValue={f.options.map(o => o.label).join('\n')}
                    onBlur={e => patch(f.id, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s })) })} /></label>
              )}
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={f.required} onChange={e => patch(f.id, { required: e.target.checked })} style={{ width: 18, height: 18 }} /><span>חובה</span></label>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={f.active} onChange={e => patch(f.id, { active: e.target.checked })} style={{ width: 18, height: 18 }} /><span>פעיל</span></label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
