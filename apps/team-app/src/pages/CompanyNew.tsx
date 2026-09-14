import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { safeUrl } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { effectiveFields, COMPANY_BUILTINS, type RenderField, type Slot } from '../lib/formLayout';
import type { CustomField } from '../components/CustomFields';
import FieldInput from '../components/FieldInput';
import FormLayoutEditor from '../components/FormLayoutEditor';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg } from '../components/Msg';

const SPAN: Record<string, number> = { full: 6, half: 3, third: 2 };

export default function CompanyNew() {
  const nav = useNavigate();
  const { can } = useAuth();
  const canBuild = can('forms', 'edit');
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [values, setValues] = useState<Record<string, any>>({ 'builtin:status': 'active' });
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => effectiveFields(COMPANY_BUILTINS, custom, slots), [custom, slots]);

  async function reloadMeta() {
    const [cf, lay] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', 'company').eq('active', true).order('sort'),
      supabase.from('form_layouts').select('slots').eq('entity_type', 'company').maybeSingle(),
    ]);
    if (!cf.error) setCustom((cf.data as CustomField[]) ?? []);
    setSlots((lay.data?.slots as Slot[]) ?? []);
  }
  useEffect(() => { reloadMeta(); }, []);

  const setVal = (ref: string, v: any) => setValues(s => ({ ...s, [ref]: v }));

  function coerce(f: RenderField, v: any): unknown {
    if (f.widget === 'number') return v ? Number(v) : null;
    if (f.widget === 'boolean') return !!v;
    if (f.widget === 'multiselect') return Array.isArray(v) ? v : [];
    return (typeof v === 'string' ? v.trim() : v) || null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const visible = fields.filter(f => !f.hidden);
    for (const f of visible) {
      const v = values[f.ref];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (f.required && empty) { setErr(`שדה חובה: ${f.label}.`); return; }
    }
    // אתר: ולידציה ונרמול (רק אם השדה מוצג ומולא).
    const siteField = visible.find(f => f.column === 'website');
    let website: string | null = null;
    if (siteField) {
      const raw = (values[siteField.ref] ?? '').trim();
      if (raw) { website = safeUrl(raw); if (!website) { setErr('כתובת האתר אינה תקינה. יש להזין כתובת http או https.'); return; } }
    }

    const body: Record<string, unknown> = {};
    const customObj: Record<string, unknown> = {};
    for (const f of visible) {
      if (f.kind === 'builtin') body[f.column!] = f.column === 'website' ? website : coerce(f, values[f.ref]);
      else customObj[f.cfKey!] = f.widget === 'boolean' ? !!values[f.ref] : (values[f.ref] ?? null);
    }
    body.custom = customObj;

    setBusy(true);
    const { error } = await supabase.from('companies').insert(body);
    setBusy(false);
    if (error) setErr(toUserMessage(error, 'שמירת החברה נכשלה.')); else nav('/companies');
  }

  return (
    <>
      <PageHead title="חברה חדשה"
        action={canBuild ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditorOpen(true)}>✎ עריכת מבנה הטופס</button> : undefined} />
      <form className="card" style={{ padding: 24, maxWidth: 560, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16 }} onSubmit={onSubmit}>
        {fields.filter(f => !f.hidden).map(f => (
          <div key={f.ref} style={{ gridColumn: `span ${SPAN[f.width] ?? 6}` }}>
            <FieldInput field={f} value={values[f.ref]} onChange={v => setVal(f.ref, v)} />
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1' }}><Msg kind="err">{err}</Msg></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/companies')}>ביטול</button>
        </div>
      </form>

      {canBuild && (
        <Dialog open={editorOpen} title="עריכת מבנה הטופס — לקוח" wide
          description="סדר, הסתרה, רוחב ותווית לשדות המובנים; הוספה/עריכה/מחיקה של שדות מכל סוג."
          onClose={() => { setEditorOpen(false); reloadMeta(); }}
          footer={<button type="button" className="btn btn-primary" onClick={() => { setEditorOpen(false); reloadMeta(); }}>סיום</button>}>
          <FormLayoutEditor entityType="company" builtins={COMPANY_BUILTINS} />
        </Dialog>
      )}
    </>
  );
}
