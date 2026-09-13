import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth, isSuperadmin } from '../lib/auth';
import { toUserMessage } from '../lib/errors';
import { effectiveFields, CANDIDATE_BUILTINS, type RenderField, type Slot } from '../lib/formLayout';
import type { CustomField } from '../components/CustomFields';
import FieldInput from '../components/FieldInput';
import FormLayoutEditor from '../components/FormLayoutEditor';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg } from '../components/Msg';

const SPAN: Record<string, number> = { full: 6, half: 3, third: 2 };

// נרמול טלפון ישראלי לפורמט אחיד, מפתח הכפילות (אפיון, 0.2).
function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+972')) return '+972' + d.slice(4).replace(/^0/, '');
  if (d.startsWith('972')) return '+972' + d.slice(3).replace(/^0/, '');
  if (d.startsWith('0')) return '+972' + d.slice(1);
  return d;
}

export default function CandidateNew() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const { employee } = useAuth();
  const canBuild = isSuperadmin(employee);

  const [custom, setCustom] = useState<CustomField[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [values, setValues] = useState<Record<string, any>>({ 'builtin:source': 'ידני' });
  const [loadedCustom, setLoadedCustom] = useState<Record<string, unknown>>({});
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const fields = useMemo(() => effectiveFields(CANDIDATE_BUILTINS, custom, slots), [custom, slots]);

  async function reloadMeta() {
    const [cf, lay] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', 'candidate').eq('active', true).order('sort'),
      supabase.from('form_layouts').select('slots').eq('entity_type', 'candidate').maybeSingle(),
    ]);
    if (!cf.error) setCustom((cf.data as CustomField[]) ?? []);
    setSlots((lay.data?.slots as Slot[]) ?? []);
  }
  useEffect(() => { reloadMeta(); }, []);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    const cols = CANDIDATE_BUILTINS.map(b => b.column).join(', ');
    supabase.from('candidates').select(`${cols}, custom`).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (!alive) return;
      if (error) { setErr(toUserMessage(error, 'טעינת המועמד נכשלה.')); return; }
      if (!data) { setErr('המועמד לא נמצא.'); return; }
      const d = data as Record<string, any>;
      const v: Record<string, any> = {};
      for (const b of CANDIDATE_BUILTINS) {
        const raw = d[b.column];
        if (b.column === 'skills') v['builtin:skills'] = (raw ?? []).join(', ');
        else v['builtin:' + b.column] = raw == null ? '' : (typeof raw === 'number' ? String(raw) : raw);
      }
      const cust = (d.custom ?? {}) as Record<string, unknown>;
      setLoadedCustom(cust);
      for (const [k, val] of Object.entries(cust)) v['custom:' + k] = val;
      setValues(prev => ({ ...prev, ...v }));
    });
    return () => { alive = false; };
  }, [id, editing]);

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
      const val = values[f.ref];
      const empty = val == null || val === '' || (Array.isArray(val) && !val.length);
      if (f.required && empty) { setErr(`שדה חובה: ${f.label}.`); return; }
    }

    const body: Record<string, unknown> = {};
    const customObj: Record<string, unknown> = editing ? { ...loadedCustom } : {};
    for (const f of visible) {
      if (f.kind === 'custom') { customObj[f.cfKey!] = f.widget === 'boolean' ? !!values[f.ref] : (values[f.ref] ?? null); continue; }
      const raw = values[f.ref];
      if (f.column === 'skills') {
        body.skills = raw ? String(raw).split(',').map(s => s.trim()).filter(Boolean) : null;
      } else if (f.column === 'phone_raw') {
        body.phone_raw = (raw ?? '').trim() || null;
        body.phone_normalized = normalizePhone(raw ?? '');
      } else {
        body[f.column!] = coerce(f, raw);
      }
    }
    body.custom = customObj;

    setBusy(true);
    const res = editing
      ? await supabase.from('candidates').update(body).eq('id', id).select('id').single()
      : await supabase.from('candidates').insert(body).select('id').single();
    setBusy(false);
    if (res.error) {
      setErr(res.error.code === '23505' ? 'כבר קיים מועמד עם מספר טלפון זה.' : toUserMessage(res.error, 'שמירת המועמד נכשלה.'));
      return;
    }
    nav(`/candidates/${editing ? id : res.data!.id}`);
  }

  return (
    <>
      <PageHead title={editing ? 'עריכת מועמד' : 'מועמד חדש'}
        action={canBuild ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditorOpen(true)}>✎ עריכת מבנה הטופס</button> : undefined} />
      <form className="card" style={{ padding: 24, maxWidth: 620, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16 }} onSubmit={onSubmit}>
        {fields.filter(f => !f.hidden).map(f => (
          <div key={f.ref} style={{ gridColumn: `span ${SPAN[f.width] ?? 6}` }}>
            <FieldInput field={f} value={values[f.ref]} onChange={v => setVal(f.ref, v)} />
            {f.column === 'phone_raw' && <span className="hint">משמש לזיהוי כפילות.</span>}
          </div>
        ))}
        <div style={{ gridColumn: '1 / -1' }}><Msg kind="err">{err}</Msg></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/candidates')}>ביטול</button>
        </div>
      </form>

      {canBuild && (
        <Dialog open={editorOpen} title="עריכת מבנה הטופס — מועמד" wide
          description="סדר, הסתרה, רוחב ותווית לשדות המובנים; הוספה/עריכה/מחיקה של שדות מכל סוג."
          onClose={() => { setEditorOpen(false); reloadMeta(); }}
          footer={<button type="button" className="btn btn-primary" onClick={() => { setEditorOpen(false); reloadMeta(); }}>סיום</button>}>
          <FormLayoutEditor entityType="candidate" builtins={CANDIDATE_BUILTINS} />
        </Dialog>
      )}
    </>
  );
}
