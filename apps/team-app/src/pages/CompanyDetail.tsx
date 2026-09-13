import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPANY_STATUS, COMMISSION_BASE, JOB_STAGE, formatDate, label } from '../lib/format';
import { todayLocal } from '../lib/dates';
import { useAuth, isManager } from '../lib/auth';
import { useLoad, unwrap } from '../lib/useLoad';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Tabs, { TabPanel } from '../components/Tabs';
import Dialog from '../components/Dialog';
import { Msg, Loading } from '../components/Msg';
import { CustomFieldsView } from '../components/CustomFields';
import Contact from '../components/Contact';

type Tab = 'contacts' | 'agreements' | 'jobs';

interface Company { id: string; name: string; status: string; custom: Record<string, unknown> | null }
interface ContactRow { id: string; full_name: string; title: string | null; email: string | null; phone: string | null; is_primary: boolean }
interface AgreementRow { id: string; version: number; commission_pct: number; commission_base: string; warranty_days: number; installments: number; payment_terms_days: number; valid_from: string; valid_to: string | null }
interface JobRow { id: string; title: string; stage: string }

export default function CompanyDetail() {
  const { id } = useParams();
  const [tab, setTab] = useState<Tab>('contacts');

  const { data, err, loading, reload } = useLoad(async () => {
    const company = unwrap(await supabase.from('companies').select('*').eq('id', id).maybeSingle()) as Company | null;
    if (!company) throw { code: 'PGRST116', message: 'company not found' };
    const [ct, ag, jb] = await Promise.all([
      supabase.from('contacts').select('id, full_name, title, email, phone, is_primary').eq('company_id', id).order('is_primary', { ascending: false }),
      supabase.from('agreements').select('*').eq('company_id', id).order('version', { ascending: false }),
      supabase.from('jobs').select('id, title, stage').eq('company_id', id).order('created_at', { ascending: false }),
    ]);
    return {
      company,
      contacts: unwrap(ct) as ContactRow[],
      agreements: unwrap(ag) as AgreementRow[],
      jobs: unwrap(jb) as JobRow[],
    };
  }, [id]);

  if (loading) return <Loading />;
  if (err || !data) return <Msg kind="err">{err || 'החברה לא נמצאה.'}</Msg>;
  const { company, contacts, agreements, jobs } = data;

  return (
    <>
      <PageHead title={company.name} sub={label(COMPANY_STATUS, company.status)} />
      <div style={{ marginBottom: 16 }}><CustomFieldsView entityType="company" values={company.custom} /></div>
      <Tabs group="company" label="מידע על החברה" value={tab} onChange={setTab} tabs={[
        { key: 'contacts', label: `אנשי קשר (${contacts.length})` },
        { key: 'agreements', label: `הסכמים (${agreements.length})` },
        { key: 'jobs', label: `משרות (${jobs.length})` },
      ]} />

      {tab === 'contacts' && <TabPanel group="company" tabKey="contacts"><ContactsTab companyId={id!} rows={contacts} onChange={reload} /></TabPanel>}
      {tab === 'agreements' && <TabPanel group="company" tabKey="agreements"><AgreementsTab companyId={id!} rows={agreements} onChange={reload} /></TabPanel>}
      {tab === 'jobs' && (
        <TabPanel group="company" tabKey="jobs">
          <div className="card" style={{ overflowX: 'auto' }}>
            {jobs.length === 0 ? <p className="empty">אין משרות לחברה זו.</p> : (
              <table><thead><tr><th>תפקיד</th><th>שלב</th></tr></thead><tbody>
                {jobs.map(j => <tr key={j.id}><td style={{ fontWeight: 600 }}><Link to={`/jobs/${j.id}`}>{j.title}</Link></td><td><span className="tag mute">{label(JOB_STAGE, j.stage)}</span></td></tr>)}
              </tbody></table>
            )}
          </div>
        </TabPanel>
      )}
      <style>{`.addrow { display: grid; gap: 10px; padding: 16px; border-bottom: 1px solid var(--line); }`}</style>
    </>
  );
}

function ContactsTab({ companyId, rows, onChange }: { companyId: string; rows: ContactRow[]; onChange: () => void }) {
  const [f, setF] = useState({ full_name: '', title: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.from('contacts').insert({
      company_id: companyId, full_name: f.full_name.trim(), title: f.title.trim() || null,
      email: f.email.trim() || null, phone: f.phone.trim() || null, is_primary: rows.length === 0,
    });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'הוספת איש הקשר נכשלה.')); return; }
    setF({ full_name: '', title: '', email: '', phone: '' }); onChange();
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <form className="addrow" onSubmit={add} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', alignItems: 'end' }}>
        <label><span className="lbl">שם *</span><input value={f.full_name} onChange={e => set('full_name', e.target.value)} required /></label>
        <label><span className="lbl">תפקיד</span><input value={f.title} onChange={e => set('title', e.target.value)} /></label>
        <label><span className="lbl">דוא״ל</span><input type="email" value={f.email} onChange={e => set('email', e.target.value)} /></label>
        <label><span className="lbl">טלפון</span><input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'שומר…' : 'הוספה'}</button>
      </form>
      <Msg kind="err" style={{ margin: 12 }}>{err}</Msg>
      {rows.length > 0 && (
        <table><thead><tr><th>שם</th><th>תפקיד</th><th>דוא״ל</th><th>טלפון</th></tr></thead><tbody>
          {rows.map(c => (
            <tr key={c.id}>
              <td style={{ fontWeight: 600 }}>{c.full_name}{c.is_primary && <span className="tag brand" style={{ marginInlineStart: 6 }}>ראשי</span>}</td>
              <td>{c.title ?? '—'}</td>
              <td><Contact kind="email" value={c.email} /></td>
              <td><Contact kind="phone" value={c.phone} /></td>
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

// הסכם פעיל = בלי תאריך סיום (valid_to). "השבתה" קובעת valid_to להיום;
// "הפעלה מחדש" מנקה אותו. הסכם בשימוש בהשמה מוגן ב-restrict — מחיקה תיחסם
// (23503) ואז מוצעת השבתה.
function isAgreementActive(a: AgreementRow): boolean {
  return a.valid_to == null || a.valid_to >= todayLocal();
}

function AgreementsTab({ companyId, rows, onChange }: { companyId: string; rows: AgreementRow[]; onChange: () => void }) {
  const { employee } = useAuth();
  const canManage = isManager(employee);
  const [f, setF] = useState({ commission_pct: '', commission_base: 'monthly', warranty_days: '90', installments: '1', payment_terms_days: '30' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [del, setDel] = useState<AgreementRow | null>(null); const [delBusy, setDelBusy] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  async function add(e: FormEvent) {
    e.preventDefault(); setErr('');
    const pct = Number(f.commission_pct);
    if (!Number.isFinite(pct) || pct <= 0) { setErr('אחוז העמלה חייב להיות מספר גדול מאפס.'); return; }
    setBusy(true);
    const nextVer = rows.length ? Math.max(...rows.map(r => r.version)) + 1 : 1;
    const { error } = await supabase.from('agreements').insert({
      company_id: companyId, version: nextVer, commission_pct: pct,
      commission_base: f.commission_base, warranty_days: Number(f.warranty_days) || 0,
      installments: Number(f.installments) || 1, payment_terms_days: Number(f.payment_terms_days) || 0,
      valid_from: todayLocal(), // שעון ישראל — UTC היה רושם אתמול עד 03:00.
    });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת ההסכם נכשלה.')); return; }
    setF({ commission_pct: '', commission_base: 'monthly', warranty_days: '90', installments: '1', payment_terms_days: '30' });
    onChange();
  }

  async function toggleActive(a: AgreementRow) {
    setErr(''); setRowBusy(a.id);
    const valid_to = isAgreementActive(a) ? todayLocal() : null;
    const { error } = await supabase.from('agreements').update({ valid_to }).eq('id', a.id);
    setRowBusy(null);
    if (error) { setErr(toUserMessage(error, 'שינוי סטטוס ההסכם נכשל.')); return; }
    onChange();
  }

  async function remove() {
    if (!del) return;
    setDelBusy(true); setErr('');
    const { error } = await supabase.from('agreements').delete().eq('id', del.id);
    setDelBusy(false); setDel(null);
    if (error) {
      if ((error as { code?: string }).code === '23503') {
        setErr('לא ניתן למחוק: ההסכם משמש בהשמה קיימת. השתמשו ב"השבתה" במקום — היא מונעת שימוש בו בהמשך בלי לפגוע בהשמות שכבר נעשו.');
        return;
      }
      setErr(toUserMessage(error, 'מחיקת ההסכם נכשלה.'));
      return;
    }
    onChange();
  }

  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <form className="addrow" onSubmit={add} style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', alignItems: 'end' }}>
        <label><span className="lbl">אחוז עמלה *</span><input type="number" step="0.1" min="0.1" value={f.commission_pct} onChange={e => set('commission_pct', e.target.value)} required placeholder="15" /></label>
        <label><span className="lbl">בסיס</span><select value={f.commission_base} onChange={e => set('commission_base', e.target.value)}>{Object.entries(COMMISSION_BASE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label><span className="lbl">אחריות (ימים)</span><input type="number" min="0" value={f.warranty_days} onChange={e => set('warranty_days', e.target.value)} /></label>
        <label><span className="lbl">תשלומים</span><input type="number" min="1" value={f.installments} onChange={e => set('installments', e.target.value)} /></label>
        <label><span className="lbl">שוטף +</span><input type="number" min="0" value={f.payment_terms_days} onChange={e => set('payment_terms_days', e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'שומר…' : 'הסכם חדש'}</button>
      </form>
      <Msg kind="err" style={{ margin: 12 }}>{err}</Msg>
      {rows.length > 0 && (
        <table style={{ minWidth: 720 }}><thead><tr><th>גרסה</th><th>עמלה</th><th>בסיס</th><th>אחריות</th><th>תשלומים</th><th>תנאי תשלום</th><th>מתאריך</th><th>סטטוס</th>{canManage && <th>פעולות</th>}</tr></thead><tbody>
          {rows.map(a => {
            const active = isAgreementActive(a);
            return (
            <tr key={a.id}>
              <td className="num">{a.version}</td><td className="num">{a.commission_pct}%</td>
              <td>{label(COMMISSION_BASE, a.commission_base)}</td><td className="num">{a.warranty_days} ימים</td>
              <td className="num">{a.installments}</td><td>שוטף+{a.payment_terms_days}</td>
              <td className="num">{formatDate(a.valid_from)}</td>
              <td><span className={'tag ' + (active ? 'ok' : 'mute')}>{active ? 'פעיל' : 'מושבת ' + formatDate(a.valid_to!)}</span></td>
              {canManage && (
                <td>
                  <span style={{ display: 'inline-flex', gap: 6, whiteSpace: 'nowrap' }}>
                    <button type="button" className="btn btn-quiet btn-sm" disabled={rowBusy === a.id} onClick={() => toggleActive(a)}>
                      {active ? 'השבתה' : 'הפעלה'}
                    </button>
                    <button type="button" className="iconbtn" onClick={() => setDel(a)} aria-label={`מחיקת הסכם גרסה ${a.version}`}>🗑</button>
                  </span>
                </td>
              )}
            </tr>
          );})}
        </tbody></table>
      )}

      <Dialog open={!!del} title="מחיקת הסכם" onClose={() => setDel(null)}
        description={del ? `גרסה ${del.version} · ${del.commission_pct}%` : undefined}
        footer={<>
          <button className="btn btn-danger" disabled={delBusy} onClick={remove}>{delBusy ? 'מוחק…' : 'מחיקה'}</button>
          <button className="btn btn-quiet" onClick={() => setDel(null)}>ביטול</button>
        </>}>
        <p>מחיקה לצמיתות. אם ההסכם משמש בהשמה קיימת — היא תיחסם ותוצע השבתה במקום.</p>
      </Dialog>
    </div>
  );
}
