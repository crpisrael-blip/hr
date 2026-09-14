import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { toUserMessage } from '../lib/errors';
import { effectiveFields, JOB_BUILTINS, type RenderField, type Slot } from '../lib/formLayout';
import type { CustomField } from '../components/CustomFields';
import FieldInput from '../components/FieldInput';
import FormLayoutEditor from '../components/FormLayoutEditor';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg } from '../components/Msg';

interface Company { id: string; name: string; }
const SPAN: Record<string, number> = { full: 6, half: 3, third: 2 };

export default function JobNew() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const { can } = useAuth();
  const canBuild = can('forms', 'edit');

  const [companies, setCompanies] = useState<Company[]>([]);
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [values, setValues] = useState<Record<string, any>>({ 'builtin:headcount': '1', 'builtin:employment_scope': 'full_time' });
  const [loadedCustom, setLoadedCustom] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => effectiveFields(JOB_BUILTINS, custom, slots), [custom, slots]);

  async function reloadMeta() {
    const [cf, lay] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', 'job').eq('active', true).order('sort'),
      supabase.from('form_layouts').select('slots').eq('entity_type', 'job').maybeSingle(),
    ]);
    if (!cf.error) setCustom((cf.data as CustomField[]) ?? []);
    setSlots((lay.data?.slots as Slot[]) ?? []);
  }

  useEffect(() => {
    let alive = true;
    supabase.from('companies').select('id, name').order('name').limit(500).then(r => {
      if (!alive) return;
      if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת החברות נכשלה.')); return; }
      setCompanies(r.data as Company[]);
    });
    reloadMeta();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    const cols = JOB_BUILTINS.map(b => b.column).join(', ');
    supabase.from('jobs').select(`${cols}, custom`).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(toUserMessage(error, 'טעינת המשרה נכשלה.')); return; }
      if (!data) { setErr('המשרה לא נמצאה.'); return; }
      const d = data as Record<string, any>;
      const v: Record<string, any> = {};
      for (const b of JOB_BUILTINS) {
        const raw = d[b.column];
        v['builtin:' + b.column] = raw == null ? '' : (typeof raw === 'number' ? String(raw) : raw);
      }
      const cust = (d.custom ?? {}) as Record<string, unknown>;
      setLoadedCustom(cust);
      for (const [k, val] of Object.entries(cust)) v['custom:' + k] = val;
      setValues(prev => ({ ...prev, ...v }));
    });
    return () => { alive = false; };
  }, [id, editing]);

  const setVal = (ref: string, v: any) => setValues(s => ({ ...s, [ref]: v }));

  function coerceBuiltin(f: RenderField, v: any): unknown {
    switch (f.column) {
      case 'company_id': return v || null;
      case 'title': return (v ?? '').trim();
      case 'headcount': return v === '' || v == null ? 1 : Number(v);
      case 'salary_min':
      case 'salary_max': return v ? Number(v) : null;
      case 'employment_scope': return v || null;
      default:
        if (f.widget === 'number') return v ? Number(v) : null;
        if (f.widget === 'boolean') return !!v;
        if (f.widget === 'multiselect') return Array.isArray(v) ? v : [];
        return (typeof v === 'string' ? v.trim() : v) || null;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const visible = fields.filter(f => !f.hidden);

    for (const f of visible) {
      const v = values[f.ref];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (f.required && empty) { setErr(`שדה חובה: ${f.label}.`); return; }
    }
    const hc = visible.find(f => f.column === 'headcount');
    if (hc) {
      const n = values[hc.ref] === '' ? 1 : Number(values[hc.ref]);
      if (!Number.isInteger(n) || n < 1) { setErr('מספר התקנים חייב להיות מספר שלם מ-1 ומעלה.'); return; }
    }
    const smin = visible.find(f => f.column === 'salary_min');
    const smax = visible.find(f => f.column === 'salary_max');
    if (smin && smax) {
      const a = values[smin.ref] ? Number(values[smin.ref]) : null;
      const b = values[smax.ref] ? Number(values[smax.ref]) : null;
      if (a != null && b != null && b < a) { setErr('שכר "עד" חייב להיות גדול או שווה לשכר "מ־".'); return; }
    }

    const body: Record<string, unknown> = {};
    const customObj: Record<string, unknown> = editing ? { ...loadedCustom } : {};
    for (const f of visible) {
      if (f.kind === 'builtin') body[f.column!] = coerceBuiltin(f, values[f.ref]);
      else customObj[f.cfKey!] = f.widget === 'boolean' ? !!values[f.ref] : (values[f.ref] ?? null);
    }
    body.custom = customObj;
    if (!editing) body.stage = 'draft';

    setBusy(true);
    const { error } = editing
      ? await supabase.from('jobs').update(body).eq('id', id)
      : await supabase.from('jobs').insert(body);
    setBusy(false);
    if (error) setErr(toUserMessage(error, 'שמירת המשרה נכשלה.')); else nav('/jobs');
  }

  const companyMissing = companies.length === 0;

  return (
    <>
      <PageHead title={editing ? 'עריכת משרה' : 'משרה חדשה'}
        action={canBuild ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditorOpen(true)}>✎ עריכת מבנה הטופס</button> : undefined} />
      {companyMissing && <Msg kind="err" style={{ marginBottom: 16 }}>
        צריך קודם להקים חברה. <Link to="/companies/new">להקמת חברה</Link></Msg>}

      <form className="card" style={{ padding: 24, maxWidth: 680, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16 }} onSubmit={onSubmit}>
        {fields.filter(f => !f.hidden).map(f => (
          <div key={f.ref} style={{ gridColumn: `span ${SPAN[f.width] ?? 6}` }}>
            <FieldInput field={f} value={values[f.ref]} onChange={v => setVal(f.ref, v)} companies={companies} />
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1' }}><Msg kind="err">{err}</Msg></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/jobs')}>ביטול</button>
        </div>
      </form>

      {canBuild && (
        <Dialog open={editorOpen} title="עריכת מבנה הטופס — משרה" wide
          description="סדר, הסתרה, רוחב ותווית לשדות המובנים; הוספה/עריכה/מחיקה של שדות מכל סוג. השינוי חל על כל טופסי המשרה."
          onClose={() => { setEditorOpen(false); reloadMeta(); }}
          footer={<button type="button" className="btn btn-primary" onClick={() => { setEditorOpen(false); reloadMeta(); }}>סיום</button>}>
          <FormLayoutEditor entityType="job" builtins={JOB_BUILTINS} />
        </Dialog>
      )}
    </>
  );
}
