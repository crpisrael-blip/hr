import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PageHead from '../components/PageHead';

interface Company { id: string; name: string; }

export default function JobNew() {
  const nav = useNavigate();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [form, setForm] = useState({
    company_id: '', title: '', internal_description: '', location: '',
    employment_scope: 'full_time', headcount: 1, salary_min: '', salary_max: '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('companies').select('id, name').order('name')
      .then(r => { if (!r.error) setCompanies(r.data as Company[]); });
  }, []);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm(f => ({ ...f, [k]: v })); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.from('jobs').insert({
      company_id: form.company_id, title: form.title.trim(),
      internal_description: form.internal_description.trim() || null,
      location: form.location.trim() || null, employment_scope: form.employment_scope,
      headcount: Number(form.headcount) || 1,
      salary_min: form.salary_min ? Number(form.salary_min) : null,
      salary_max: form.salary_max ? Number(form.salary_max) : null,
      stage: 'draft',
    });
    setBusy(false);
    if (error) setErr(error.message); else nav('/jobs');
  }

  return (
    <>
      <PageHead title="משרה חדשה" />
      {companies.length === 0 && <p className="msg err" style={{ marginBottom: 16 }}>
        צריך קודם להקים חברה. <a href="/companies/new">להקמת חברה</a></p>}
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
              <option value="full_time">מלאה</option><option value="part_time">חלקית</option>
              <option value="temporary">זמני</option><option value="contract">חוזה</option><option value="student">סטודנט</option>
            </select></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <label><span className="lbl">תקנים</span>
            <input type="number" min={1} value={form.headcount} onChange={e => set('headcount', Number(e.target.value))} /></label>
          <label><span className="lbl">שכר מ־</span>
            <input type="number" min={0} value={form.salary_min} onChange={e => set('salary_min', e.target.value)} /></label>
          <label><span className="lbl">שכר עד</span>
            <input type="number" min={0} value={form.salary_max} onChange={e => set('salary_max', e.target.value)} /></label>
        </div>
        {err && <p className="msg err">{err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !form.company_id}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/jobs')}>ביטול</button>
        </div>
      </form>
    </>
  );
}
