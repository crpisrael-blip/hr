import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPANY_STATUS, COMMISSION_BASE, JOB_STAGE, formatDate } from '../lib/format';
import PageHead from '../components/PageHead';
import { CustomFieldsView } from '../components/CustomFields';

type Tab = 'contacts' | 'agreements' | 'jobs';

export default function CompanyDetail() {
  const { id } = useParams();
  const [company, setCompany] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('contacts');
  const [contacts, setContacts] = useState<any[]>([]);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    const c = await supabase.from('companies').select('*').eq('id', id).maybeSingle();
    if (c.error) { setErr(c.error.message); return; }
    setCompany(c.data);
    const [ct, ag, jb] = await Promise.all([
      supabase.from('contacts').select('*').eq('company_id', id).order('is_primary', { ascending: false }),
      supabase.from('agreements').select('*').eq('company_id', id).order('version', { ascending: false }),
      supabase.from('jobs').select('id, title, stage').eq('company_id', id).order('created_at', { ascending: false }),
    ]);
    if (!ct.error) setContacts(ct.data);
    if (!ag.error) setAgreements(ag.data);
    if (!jb.error) setJobs(jb.data);
  }
  useEffect(() => { load(); }, [id]);

  if (err) return <p className="msg err">{err}</p>;
  if (!company) return <p className="spinner">טוען…</p>;

  return (
    <>
      <PageHead title={company.name} sub={COMPANY_STATUS[company.status]} />
      <div style={{ marginBottom: 16 }}><CustomFieldsView entityType="company" values={company.custom} /></div>
      <div className="tabs">
        <button className={tab==='contacts'?'on':''} onClick={()=>setTab('contacts')}>אנשי קשר ({contacts.length})</button>
        <button className={tab==='agreements'?'on':''} onClick={()=>setTab('agreements')}>הסכמים ({agreements.length})</button>
        <button className={tab==='jobs'?'on':''} onClick={()=>setTab('jobs')}>משרות ({jobs.length})</button>
      </div>

      {tab==='contacts' && <ContactsTab companyId={id!} rows={contacts} onChange={load} />}
      {tab==='agreements' && <AgreementsTab companyId={id!} rows={agreements} onChange={load} />}
      {tab==='jobs' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          {jobs.length===0 ? <p className="empty">אין משרות לחברה זו.</p> : (
            <table><thead><tr><th>תפקיד</th><th>שלב</th></tr></thead><tbody>
              {jobs.map(j=><tr key={j.id}><td style={{fontWeight:600}}><Link to={`/jobs`}>{j.title}</Link></td><td><span className="tag mute">{JOB_STAGE[j.stage]}</span></td></tr>)}
            </tbody></table>
          )}
        </div>
      )}
      <style>{`
        .tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--line); }
        .tabs button { background: none; border: none; padding: 10px 14px; cursor: pointer; color: var(--ink-mid); font-weight: 600; border-bottom: 2px solid transparent; }
        .tabs button.on { color: var(--brand); border-bottom-color: var(--brand); }
        .addrow { display: grid; gap: 10px; padding: 16px; border-bottom: 1px solid var(--line); }
      `}</style>
    </>
  );
}

function ContactsTab({ companyId, rows, onChange }: { companyId: string; rows: any[]; onChange: () => void }) {
  const [f, setF] = useState({ full_name: '', title: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.from('contacts').insert({ company_id: companyId, full_name: f.full_name.trim(), title: f.title.trim()||null, email: f.email.trim()||null, phone: f.phone.trim()||null, is_primary: rows.length===0 });
    setBusy(false); if (error) { setErr(error.message); return; }
    setF({ full_name:'', title:'', email:'', phone:'' }); onChange();
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <form className="addrow" onSubmit={add} style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 1fr auto' }}>
        <input placeholder="שם *" value={f.full_name} onChange={e=>set('full_name',e.target.value)} required />
        <input placeholder="תפקיד" value={f.title} onChange={e=>set('title',e.target.value)} />
        <input placeholder="דוא״ל" type="email" value={f.email} onChange={e=>set('email',e.target.value)} />
        <input placeholder="טלפון" value={f.phone} onChange={e=>set('phone',e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={busy}>הוספה</button>
      </form>
      {err && <p className="msg err" style={{ margin: 12 }}>{err}</p>}
      {rows.length>0 && (
        <table><thead><tr><th>שם</th><th>תפקיד</th><th>דוא״ל</th><th>טלפון</th></tr></thead><tbody>
          {rows.map(c=><tr key={c.id}><td style={{fontWeight:600}}>{c.full_name}{c.is_primary && <span className="tag brand" style={{marginRight:6}}>ראשי</span>}</td><td>{c.title??'—'}</td><td>{c.email??'—'}</td><td>{c.phone??'—'}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

function AgreementsTab({ companyId, rows, onChange }: { companyId: string; rows: any[]; onChange: () => void }) {
  const [f, setF] = useState({ commission_pct: '', commission_base: 'monthly', warranty_days: '90', installments: '1', payment_terms_days: '30' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const nextVer = rows.length ? Math.max(...rows.map(r=>r.version)) + 1 : 1;
    const { error } = await supabase.from('agreements').insert({
      company_id: companyId, version: nextVer, commission_pct: Number(f.commission_pct),
      commission_base: f.commission_base, warranty_days: Number(f.warranty_days),
      installments: Number(f.installments), payment_terms_days: Number(f.payment_terms_days),
      valid_from: new Date().toISOString().slice(0,10),
    });
    setBusy(false); if (error) { setErr(error.message); return; }
    onChange();
  }
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <form className="addrow" onSubmit={add} style={{ gridTemplateColumns: 'repeat(5, 1fr) auto', alignItems: 'end' }}>
        <label><span className="lbl">אחוז עמלה *</span><input type="number" step="0.1" value={f.commission_pct} onChange={e=>set('commission_pct',e.target.value)} required placeholder="15" /></label>
        <label><span className="lbl">בסיס</span><select value={f.commission_base} onChange={e=>set('commission_base',e.target.value)}><option value="monthly">חודשי</option><option value="annual">שנתי</option></select></label>
        <label><span className="lbl">אחריות (ימים)</span><input type="number" value={f.warranty_days} onChange={e=>set('warranty_days',e.target.value)} /></label>
        <label><span className="lbl">תשלומים</span><input type="number" min="1" value={f.installments} onChange={e=>set('installments',e.target.value)} /></label>
        <label><span className="lbl">שוטף +</span><input type="number" value={f.payment_terms_days} onChange={e=>set('payment_terms_days',e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>הסכם חדש</button>
      </form>
      {err && <p className="msg err" style={{ margin: 12 }}>{err}</p>}
      {rows.length>0 && (
        <table><thead><tr><th>גרסה</th><th>עמלה</th><th>בסיס</th><th>אחריות</th><th>תשלומים</th><th>תנאי תשלום</th><th>מתאריך</th></tr></thead><tbody>
          {rows.map(a=><tr key={a.id}><td className="num">{a.version}</td><td className="num">{a.commission_pct}%</td><td>{COMMISSION_BASE[a.commission_base]}</td><td className="num">{a.warranty_days} ימים</td><td className="num">{a.installments}</td><td>שוטף+{a.payment_terms_days}</td><td className="num">{formatDate(a.valid_from)}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}
