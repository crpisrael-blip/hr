import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { SCOPE } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg } from '../components/Msg';
import { CustomFieldsEdit } from '../components/CustomFields';

interface Company { id: string; name: string; }

export default function JobNew() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({
    company_id: '', title: '', internal_description: '', location: '',
    employment_scope: 'full_time', headcount: '1', salary_min: '', salary_max: '',
  });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from('companies').select('id, name').order('name').limit(500)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת החברות נכשלה.')); return; }
        setCompanies(r.data as Company[]);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    supabase.from('jobs').select('company_id, title, internal_description, location, employment_scope, headcount, salary_min, salary_max, custom')
      .eq('id', id).maybeSingle().then(({ data, error }) => {
        if (!alive) return;
        if (error) { setErr(toUserMessage(error, 'טעינת המשרה נכשלה.')); return; }
        if (!data) { setErr('המשרה לא נמצאה.'); return; }
        setForm({
          company_id: data.company_id ?? '', title: data.title ?? '',
          internal_description: data.internal_description ?? '', location: data.location ?? '',
          employment_scope: data.employment_scope ?? 'full_time',
          headcount: data.headcount != null ? String(data.headcount) : '1',
          salary_min: data.salary_min != null ? String(data.salary_min) : '',
          salary_max: data.salary_max != null ? String(data.salary_max) : '',
        });
        setCustom(data.custom ?? {});
      });
    return () => { alive = false; };
  }, [id, editing]);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm(f => ({ ...f, [k]: v })); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const headcount = form.headcount.trim() === '' ? 1 : Number(form.headcount);
    if (!Number.isInteger(headcount) || headcount < 1) { setErr('מספר התקנים חייב להיות מספר שלם מ-1 ומעלה.'); setBusy(false); return; }
    const min = form.salary_min ? Number(form.salary_min) : null;
    const max = form.salary_max ? Number(form.salary_max) : null;
    if (min != null && max != null && max < min) { setErr('שכר "עד" חייב להיות גדול או שווה לשכר "מ־".'); setBusy(false); return; }
    const body: Record<string, unknown> = {
      company_id: form.company_id, title: form.title.trim(),
      internal_description: form.internal_description.trim() || null,
      location: form.location.trim() || null, employment_scope: form.employment_scope,
      headcount,
      salary_min: min, salary_max: max,
      custom,
    };
    if (!editing) body.stage = 'draft';
    const { error } = editing
      ? await supabase.from('jobs').update(body).eq('id', id)
      : await supabase.from('jobs').insert(body);
    setBusy(false);
    if (error) setErr(toUserMessage(error, 'שמירת המשרה נכשלה.')); else nav('/jobs');
  }

  return (
    <>
      <PageHead title={editing ? 'עריכת משרה' : 'משרה חדשה'} />
      {companies.length === 0 && <Msg kind="err" style={{ marginBottom: 16 }}>
        צריך קודם להקים חברה. <Link to="/companies/new">להקמת חברה</Link></Msg>}
      <form className="card" style={{ padding: 24, maxWidth: 620, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">חברה *</span>
          <select value={form.company_id} onChange={e => set('company_id', e.target.value)} required>
            <option value="">בחרו חברה…</option>
            {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></label>
        <label><span className="lbl">תפקיד *</span>
          <input value={form.title} onChange={e => set('title', e.target.value)} required /></label>
        <label><span className="lbl">תיאור פנימי</span>
          <textarea value={form.internal_description} onChange={e => set('internal_description', e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label><span className="lbl">מיקום</span>
            <input value={form.location} onChange={e => set('location', e.target.value)} /></label>
          <label><span className="lbl">היקף</span>
            <select value={form.employment_scope} onChange={e => set('employment_scope', e.target.value)}>
              {Object.entries(SCOPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <label><span className="lbl">תקנים</span>
            <input type="number" min={1} step={1} value={form.headcount} onChange={e => set('headcount', e.target.value)} /></label>
          <label><span className="lbl">שכר מ־</span>
            <input type="number" min={0} value={form.salary_min} onChange={e => set('salary_min', e.target.value)} /></label>
          <label><span className="lbl">שכר עד</span>
            <input type="number" min={0} value={form.salary_max} onChange={e => set('salary_max', e.target.value)} /></label>
        </div>
        <CustomFieldsEdit entityType="job" values={custom} onChange={setCustom} />
        <Msg kind="err">{err}</Msg>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !form.company_id}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/jobs')}>ביטול</button>
        </div>
      </form>
    </>
  );
}
