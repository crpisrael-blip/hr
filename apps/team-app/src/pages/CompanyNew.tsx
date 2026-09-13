import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPANY_STATUS, safeUrl } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg } from '../components/Msg';
import { CustomFieldsEdit } from '../components/CustomFields';

export default function CompanyNew() {
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [status, setStatus] = useState('active');
  const [website, setWebsite] = useState('');
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const site = website.trim() ? safeUrl(website) : null;
    if (website.trim() && !site) { setErr('כתובת האתר אינה תקינה. יש להזין כתובת http או https.'); return; }
    setBusy(true);
    const { error } = await supabase.from('companies')
      .insert({ name: name.trim(), status, website: site, custom });
    setBusy(false);
    if (error) setErr(toUserMessage(error, 'שמירת החברה נכשלה.')); else nav('/companies');
  }

  return (
    <>
      <PageHead title="חברה חדשה" />
      <form className="card" style={{ padding: 24, maxWidth: 520, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">שם החברה *</span>
          <input value={name} onChange={e => setName(e.target.value)} required autoFocus /></label>
        <label><span className="lbl">סטטוס</span>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            {Object.entries(COMPANY_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <label><span className="lbl">אתר</span>
          <input type="url" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" /></label>
        <CustomFieldsEdit entityType="company" values={custom} onChange={setCustom} />
        <Msg kind="err">{err}</Msg>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/companies')}>ביטול</button>
        </div>
      </form>
    </>
  );
}
