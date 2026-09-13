import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import {
  effectiveFields, fieldsToSlots, loadLayout, saveLayout,
  type BuiltinField, type RenderField, type FieldWidth,
} from '../lib/formLayout';
import { CF_TYPES, type CustomField } from './CustomFields';
import { Msg } from './Msg';

const WIDTHS: [FieldWidth, string][] = [['full', 'רוחב מלא'], ['half', 'חצי'], ['third', 'שליש']];
const hasOptions = (t: string) => t === 'select' || t === 'multiselect';
const newKey = () => 'cf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// בנאי מבנה הטופס למנהל-על: סדר, הסתרה, רוחב, תווית, וכל פעולות השדות המותאמים.
// שדה נעול (חובה במסד) מסומן ולא ניתן להסתרה/מחיקה.
export default function FormLayoutEditor({ entityType, builtins }:
  { entityType: string; builtins: BuiltinField[] }) {
  const { employee } = useAuth();
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [fields, setFields] = useState<RenderField[]>([]);
  const [err, setErr] = useState('');

  async function reload() {
    const [cf, slots] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', entityType).order('sort'),
      loadLayout(entityType),
    ]);
    if (cf.error) { setErr(cf.error.message); return; }
    const cfRows = (cf.data as CustomField[]) ?? [];
    setCustom(cfRows);
    setFields(effectiveFields(builtins, cfRows, slots));
  }
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [entityType]);

  async function persist(next: RenderField[]) {
    setFields(next);
    const { error } = await saveLayout(entityType, fieldsToSlots(next, builtins), employee?.id);
    if (error) setErr((error as { message?: string }).message ?? 'שמירת מבנה הטופס נכשלה.');
  }

  function move(i: number, d: number) {
    const j = i + d; if (j < 0 || j >= fields.length) return;
    const next = fields.slice(); [next[i], next[j]] = [next[j], next[i]]; persist(next);
  }
  function toggleHidden(i: number) {
    const f = fields[i]; if (f.locked) return;
    const next = fields.slice(); next[i] = { ...f, hidden: !f.hidden }; persist(next);
  }
  function setWidth(i: number, w: FieldWidth) {
    const next = fields.slice(); next[i] = { ...next[i], width: w }; persist(next);
  }
  function setLabelLocal(i: number, label: string) {
    const next = fields.slice(); next[i] = { ...next[i], label }; setFields(next);
  }
  async function commitBuiltinLabel() { await persist(fields); }

  async function patchCustom(cfKey: string, p: Partial<CustomField>) {
    const { error } = await supabase.from('custom_fields').update(p).eq('entity_type', entityType).eq('key', cfKey);
    if (error) { setErr(error.message); return; }
    await reload();
  }
  async function addField() {
    const sort = custom.length ? Math.max(...custom.map(c => c.sort)) + 1 : 0;
    const { error } = await supabase.from('custom_fields')
      .insert({ entity_type: entityType, key: newKey(), label: 'שדה חדש', type: 'text', sort });
    if (error) { setErr(error.message); return; }
    // reload כדי לקבל את השדה, ואז materializing כדי לקבע את מיקומו בסוף.
    const [cf, slots] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', entityType).order('sort'),
      loadLayout(entityType),
    ]);
    const cfRows = (cf.data as CustomField[]) ?? [];
    setCustom(cfRows);
    const next = effectiveFields(builtins, cfRows, slots);
    await persist(next);
  }
  async function deleteCustom(cfKey: string) {
    if (!confirm('למחוק את השדה? ערכים שכבר נשמרו יישארו במסד אך לא יוצגו.')) return;
    const { error } = await supabase.from('custom_fields').delete().eq('entity_type', entityType).eq('key', cfKey);
    if (error) { setErr(error.message); return; }
    const next = fields.filter(f => f.ref !== 'custom:' + cfKey);
    setCustom(custom.filter(c => c.key !== cfKey));
    await persist(next);
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="spread">
        <p className="hint" style={{ margin: 0 }}>גררו סדר עם ↑↓, הסתירו, שנו רוחב ותווית, או הוסיפו/מחקו שדות. שדה נעול (חובה) לא ניתן להסתרה.</p>
        <button type="button" className="btn btn-quiet btn-sm" onClick={addField}>+ שדה חדש</button>
      </div>
      <Msg kind="err">{err}</Msg>

      <div style={{ display: 'grid', gap: 8 }}>
        {fields.map((f, i) => {
          const cf = f.kind === 'custom' ? custom.find(c => c.key === f.cfKey) : undefined;
          return (
            <div key={f.ref} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: 10, display: 'grid', gap: 8, opacity: f.hidden ? 0.6 : 1 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" className="iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="למעלה">↑</button>
                  <button type="button" className="iconbtn" onClick={() => move(i, 1)} disabled={i === fields.length - 1} aria-label="למטה">↓</button>
                </div>
                <input style={{ flex: 1, minWidth: 140 }} value={f.label}
                  onChange={e => setLabelLocal(i, e.target.value)}
                  onBlur={() => f.kind === 'builtin' ? commitBuiltinLabel() : (cf && f.label !== cf.label && patchCustom(f.cfKey!, { label: f.label }))} />
                <span className="tag mute">{f.kind === 'builtin' ? 'מובנה' : 'מותאם'}{f.locked ? ' · נעול' : ''}</span>
                <select value={f.width} onChange={e => setWidth(i, e.target.value as FieldWidth)} style={{ width: 'auto' }}>
                  {WIDTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: f.locked ? 0.5 : 1 }}>
                  <input type="checkbox" checked={!f.hidden} disabled={f.locked} onChange={() => toggleHidden(i)} style={{ width: 16, height: 16 }} /><span>מוצג</span>
                </label>
                {f.kind === 'custom' && <button type="button" className="iconbtn" onClick={() => deleteCustom(f.cfKey!)} aria-label="מחיקה">🗑</button>}
              </div>

              {cf && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <label><span className="lbl">סוג</span>
                    <select value={cf.type} onChange={e => patchCustom(cf.key, { type: e.target.value })}>
                      {CF_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select></label>
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'end' }}>
                    <input type="checkbox" checked={cf.required} onChange={e => patchCustom(cf.key, { required: e.target.checked })} style={{ width: 16, height: 16 }} /><span>חובה</span></label>
                  {hasOptions(cf.type) && (
                    <label style={{ gridColumn: '1 / -1' }}><span className="lbl">אפשרויות (שורה לכל אחת)</span>
                      <textarea rows={3} defaultValue={cf.options.map(o => o.label).join('\n')}
                        onBlur={e => patchCustom(cf.key, { options: e.target.value.split('\n').map(s => s.trim()).filter(Boolean).map(s => ({ value: s, label: s })) })} /></label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
