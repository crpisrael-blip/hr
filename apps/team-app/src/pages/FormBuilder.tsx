import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { RECIPIENTS, FILING_TARGETS, MAPPABLE, FORM_CATEGORIES, columnsForTable } from '../lib/entities';
import PageHead from '../components/PageHead';

const TYPES: [string, string][] = [
  ['text','טקסט קצר'], ['textarea','טקסט ארוך'], ['number','מספר'], ['date','תאריך'], ['time','שעה'],
  ['boolean','כן/לא'], ['select','בחירה יחידה'], ['multiselect','בחירה מרובה'], ['list','רשימה'],
  ['heading','כותרת'], ['paragraph','הסבר'], ['signature','חתימה'],
];
const hasOptions = (t: string) => t === 'select' || t === 'multiselect';

type Field = { key: string; type: string; label: string; help?: string; required?: boolean; options?: {value:string;label:string}[]; show_if?: {field:string;equals:string} };
type MapRow = { field_key: string; table: string; column: string; mode: 'auto'|'approve' };

let seq = 1;
const newKey = () => 'f' + (Date.now().toString(36)) + (seq++);

export default function FormBuilder() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [recipient, setRecipient] = useState('general');
  const [filingTarget, setFilingTarget] = useState('general');
  const [filingCategory, setFilingCategory] = useState('');
  const [status, setStatus] = useState('draft');
  const [siteApply, setSiteApply] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) return;
    supabase.from('form_templates').select('*').eq('id', id).maybeSingle().then(({ data, error }) => {
      if (error || !data) { setErr('התבנית לא נמצאה'); return; }
      setName(data.name ?? ''); setDescription(data.description ?? ''); setRecipient(data.recipient_type);
      setFilingTarget(data.filing_target ?? 'general'); setFilingCategory(data.filing_category ?? ''); setStatus(data.status);
      setSiteApply(!!data.is_site_apply);
      setFields((data.definition?.fields ?? []) as Field[]); setMaps((data.field_map ?? []) as MapRow[]);
    });
  }, [id, editing]);

  const addField = () => setFields(f => [...f, { key: newKey(), type: 'text', label: '', required: false }]);
  const upField = (i: number, patch: Partial<Field>) => setFields(f => f.map((x, n) => n === i ? { ...x, ...patch } : x));
  const delField = (i: number) => setFields(f => f.filter((_, n) => n !== i));
  const moveField = (i: number, d: number) => setFields(f => { const a = [...f]; const j = i + d; if (j < 0 || j >= a.length) return f; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const setOptions = (i: number, text: string) => upField(i, { options: text.split('\n').filter(Boolean).map(s => ({ value: s.trim(), label: s.trim() })) });

  async function save() {
    setErr('');
    if (!name.trim()) { setErr('נא להזין שם לטופס.'); return; }
    for (const f of fields) if (!['heading','paragraph'].includes(f.type) && !f.label.trim()) { setErr('לכל שדה צריך שם.'); return; }
    setBusy(true);
    const body = {
      name: name.trim(), description: description.trim() || null, recipient_type: recipient,
      definition: { fields: fields.map((f, i) => ({ ...f, order: i })) },
      field_map: maps.filter(m => m.field_key && m.table && m.column),
      filing_target: filingTarget, filing_category: filingCategory.trim() || null, status,
      is_site_apply: siteApply,
    };
    // רק תבנית אחת יכולה לשמש כטופס ההגשה באתר — מכבים אחרות לפני השמירה.
    if (siteApply) await supabase.from('form_templates').update({ is_site_apply: false }).eq('is_site_apply', true);
    const res = editing
      ? await supabase.from('form_templates').update(body).eq('id', id).select('id').single()
      : await supabase.from('form_templates').insert(body).select('id').single();
    setBusy(false);
    if (res.error) { setErr(res.error.message); return; }
    nav('/forms');
  }

  const fieldOptionsForCondition = fields.filter(f => hasOptions(f.type) || f.type === 'boolean');

  return (
    <>
      <PageHead title={editing ? 'עריכת טופס' : 'טופס חדש'} sub="בונה טפסים"
        action={<button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? 'שומר…' : 'שמירה'}</button>} />
      {err && <p className="msg err">{err}</p>}

      <div className="card" style={{ padding: 20, display: 'grid', gap: 14, marginBottom: 16 }}>
        <h2 className="sec">הגדרות הטופס</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <label><span className="lbl">שם הטופס *</span><input value={name} onChange={e => setName(e.target.value)} /></label>
          <label><span className="lbl">מיועד ל־</span><select value={recipient} onChange={e => setRecipient(e.target.value)}>{RECIPIENTS.map(r=><option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        </div>
        <label><span className="lbl">תיאור / הנחיה לנמען</span><input value={description} onChange={e => setDescription(e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          <label><span className="lbl">יעד תיוק</span><select value={filingTarget} onChange={e => setFilingTarget(e.target.value)}>{FILING_TARGETS.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}</select></label>
          <label><span className="lbl">קטגוריית תיוק</span>
            <input list="form-categories" value={filingCategory} onChange={e => setFilingCategory(e.target.value)} placeholder="קליטה / ראיון / אישורים…" />
            <datalist id="form-categories">{FORM_CATEGORIES.map(c=><option key={c} value={c} />)}</datalist></label>
          <label><span className="lbl">סטטוס</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="draft">טיוטה</option><option value="active">פעיל</option><option value="archived">בארכיון</option></select></label>
        </div>
        {recipient === 'candidate' && (
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 10, background: 'var(--surface-sunk)', padding: '10px 12px', borderRadius: 9 }}>
            <input type="checkbox" checked={siteApply} onChange={e => setSiteApply(e.target.checked)} style={{ width: 18, height: 18 }} />
            <span>השתמש כטופס ההגשה באתר — השדות יופיעו מתחת לשדות הבסיס (שם/טלפון/דוא״ל/קו״ח). רק תבנית פעילה אחת יכולה לשמש לכך.</span>
          </label>
        )}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div className="spread" style={{ marginBottom: 12 }}><h2 className="sec" style={{ margin: 0 }}>שדות ({fields.length})</h2>
          <button className="btn btn-quiet btn-sm" onClick={addField}>+ שדה</button></div>
        {fields.length === 0 && <p className="hint">אין עדיין שדות. הוסיפו שדה ראשון.</p>}
        <div style={{ display: 'grid', gap: 12 }}>
          {fields.map((f, i) => (
            <div key={f.key} style={{ border: '1px solid var(--line)', borderRadius: 11, padding: 12, display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 10, alignItems: 'end' }}>
                <label><span className="lbl">שם השדה</span><input value={f.label} onChange={e => upField(i, { label: e.target.value })}
                  placeholder={f.type === 'heading' ? 'כותרת' : f.type === 'paragraph' ? 'טקסט הסבר' : 'שאלה'} /></label>
                <label><span className="lbl">סוג</span><select value={f.type} onChange={e => upField(i, { type: e.target.value })}>{TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-quiet btn-sm" onClick={() => moveField(i, -1)} title="למעלה">↑</button>
                  <button className="btn btn-quiet btn-sm" onClick={() => moveField(i, 1)} title="למטה">↓</button>
                  <button className="btn btn-quiet btn-sm" onClick={() => delField(i)} title="מחיקה">🗑</button>
                </div>
              </div>
              {!['heading'].includes(f.type) && <label><span className="lbl">הסבר (רשות)</span><input value={f.help ?? ''} onChange={e => upField(i, { help: e.target.value })} /></label>}
              {hasOptions(f.type) && <label><span className="lbl">אפשרויות (שורה לכל אפשרות)</span>
                <textarea rows={3} value={(f.options ?? []).map(o => o.label).join('\n')} onChange={e => setOptions(i, e.target.value)} /></label>}
              {!['heading','paragraph'].includes(f.type) && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!f.required} onChange={e => upField(i, { required: e.target.checked })} style={{ width: 18, height: 18 }} /><span>חובה</span></label>
                  {fieldOptionsForCondition.filter(c => c.key !== f.key).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: '.85rem' }}>
                      <span className="hint">הצג רק אם:</span>
                      <select value={f.show_if?.field ?? ''} onChange={e => upField(i, { show_if: e.target.value ? { field: e.target.value, equals: f.show_if?.equals ?? '' } : undefined })}>
                        <option value="">תמיד</option>
                        {fieldOptionsForCondition.filter(c => c.key !== f.key).map(c => <option key={c.key} value={c.key}>{c.label || c.key}</option>)}
                      </select>
                      {f.show_if?.field && <input placeholder="שווה ל…" value={f.show_if.equals} onChange={e => upField(i, { show_if: { field: f.show_if!.field, equals: e.target.value } })} style={{ maxWidth: 140 }} />}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <div className="spread" style={{ marginBottom: 8 }}><h2 className="sec" style={{ margin: 0 }}>מיפוי לשדות המערכת (רשות)</h2>
          <button className="btn btn-quiet btn-sm" onClick={() => setMaps(m => [...m, { field_key: '', table: 'candidates', column: '', mode: 'approve' }])}>+ מיפוי</button></div>
        <p className="hint" style={{ marginBottom: 10 }}>תשובה בשדה יכולה לעדכן רשומה במערכת. "אוטומטי" מעדכן עם ההשלמה; "לאישור" ממתין לאישור בכרטיס הטופס.</p>
        {maps.length === 0 ? <p className="hint">אין מיפויים.</p> : (
          <div style={{ display: 'grid', gap: 8 }}>
            {maps.map((m, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr .9fr auto', gap: 8, alignItems: 'center' }}>
                <select value={m.field_key} onChange={e => setMaps(a => a.map((x, n) => n === i ? { ...x, field_key: e.target.value } : x))}>
                  <option value="">שדה בטופס…</option>
                  {fields.filter(f => !['heading','paragraph'].includes(f.type)).map(f => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                </select>
                <select value={m.table} onChange={e => setMaps(a => a.map((x, n) => n === i ? { ...x, table: e.target.value, column: '' } : x))}>{MAPPABLE.map(en=><option key={en.table} value={en.table}>{en.label}</option>)}</select>
                <select value={m.column} onChange={e => setMaps(a => a.map((x, n) => n === i ? { ...x, column: e.target.value } : x))}>
                  <option value="">בחר/י עמודה…</option>
                  {columnsForTable(m.table).map(c => <option key={c.col} value={c.col}>{c.label}</option>)}
                  {m.column && !columnsForTable(m.table).some(c => c.col === m.column) && <option value={m.column}>{m.column}</option>}
                </select>
                <select value={m.mode} onChange={e => setMaps(a => a.map((x, n) => n === i ? { ...x, mode: e.target.value as any } : x))}><option value="approve">לאישור</option><option value="auto">אוטומטי</option></select>
                <button className="btn btn-quiet btn-sm" onClick={() => setMaps(a => a.filter((_, n) => n !== i))}>🗑</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <style>{`.sec{font-size:1.05rem;} .spread{display:flex;justify-content:space-between;align-items:center;}`}</style>
    </>
  );
}
