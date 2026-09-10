import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PageHead from '../components/PageHead';
import { CustomFieldsEdit } from '../components/CustomFields';

export default function CompanyNew() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [website, setWebsite] = useState('');
  const [custom, setCustom] = useState<Record<string, any>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.from('companies')
      .insert({ name: name.trim(), status, website: website.trim() || null, custom });
    setBusy(false);
    if (error) setErr(error.message); else nav('/companies');
  }

  return (
    <>
      <PageHead title="חברה חדשה" />
      <form className="card" style={{ padding: 24, maxWidth: 520, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">שם החברה *</span>
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus /></label>
        <label><span className="lbl">סטטוס</span>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="lead">ליד</option><option value="active">פעילה</option>
            <option value="on_hold">בהמתנה</option><option value="inactive">לא פעילה</option>
          </select></label>
        <label><span className="lbl">אתר</span>
          <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" /></label>
        <CustomFieldsEdit entityType="company" values={custom} onChange={setCustom} />
        {err && <p className="msg err">{err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/companies')}>ביטול</button>
        </div>
      </form>
    </>
  );
}
