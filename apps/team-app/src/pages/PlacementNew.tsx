import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMMISSION_BASE, money } from '../lib/format';
import PageHead from '../components/PageHead';

export default function PlacementNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const applicationId = sp.get('application') ?? '';
  const [appl, setAppl] = useState<any>(null);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [agreementId, setAgreementId] = useState('');
  const [salary, setSalary] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0,10));
  const [emps, setEmps] = useState<any[]>([]);
  const [recruiterId, setRecruiterId] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const a = await supabase.from('applications')
        .select('id, recruiter_id, candidates(full_name), jobs(title, company_id, companies(name))')
        .eq('id', applicationId).maybeSingle();
      if (a.error || !a.data) { setErr('המועמדות לא נמצאה'); return; }
      setAppl(a.data);
      setRecruiterId((a.data as any).recruiter_id ?? '');
      const companyId = (a.data as any).jobs?.company_id;
      const ag = await supabase.from('agreements').select('*').eq('company_id', companyId).order('version', { ascending: false });
      if (!ag.error) { setAgreements(ag.data); if (ag.data[0]) setAgreementId(ag.data[0].id); }
      const em = await supabase.from('employees').select('id, full_name').eq('employment_status','active').order('full_name');
      if (!em.error) setEmps(em.data);
    })();
  }, [applicationId]);

  const selected = agreements.find(a => a.id === agreementId);
  const preview = selected && salary
    ? Math.round(Number(salary) * (selected.commission_base==='annual'?12:1) * selected.commission_pct/100 * 100)/100
    : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (!recruiterId) { setErr('יש לבחור מגייס זכאי לבונוס.'); return; }
    setBusy(true);
    // נעילת המגייס הזכאי: create_placement יורש את recruiter_id מהמועמדות,
    // לכן מעדכנים אותו במועמדות אם שונה לפני יצירת ההשמה.
    if (recruiterId !== appl.recruiter_id) {
      const up = await supabase.from('applications').update({ recruiter_id: recruiterId }).eq('id', applicationId);
      if (up.error) { setErr(up.error.message); setBusy(false); return; }
    }
    const { data, error } = await supabase.rpc('create_placement', {
      p_application_id: applicationId, p_agreement_id: agreementId,
      p_agreed_salary: Number(salary), p_expected_start: startDate,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    nav(`/placements/${data}`);
  }

  if (err && !appl) return <p className="msg err">{err}</p>;
  if (!appl) return <p className="spinner">טוען…</p>;

  return (
    <>
      <PageHead title="יצירת השמה" sub={`${appl.candidates?.full_name} · ${appl.jobs?.title} · ${appl.jobs?.companies?.name ?? ''}`} />
      {agreements.length === 0 && <p className="msg err" style={{ marginBottom: 16 }}>
        אין הסכם מסחרי לחברה. צריך להגדיר הסכם בכרטיס החברה לפני יצירת השמה.</p>}
      <form className="card" style={{ padding: 24, maxWidth: 560, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">הסכם מסחרי *</span>
          <select value={agreementId} onChange={e=>setAgreementId(e.target.value)} required>
            {agreements.map(a=><option key={a.id} value={a.id}>גרסה {a.version} · {a.commission_pct}% · {COMMISSION_BASE[a.commission_base]} · אחריות {a.warranty_days} ימים</option>)}
          </select></label>
        <label><span className="lbl">שכר חודשי שסוכם *</span>
          <input type="number" value={salary} onChange={e=>setSalary(e.target.value)} required placeholder="למשל 15000" /></label>
        <label><span className="lbl">תאריך תחילת עבודה צפוי</span>
          <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} /></label>
        <label><span className="lbl">מגייס זכאי לבונוס *</span>
          <select value={recruiterId} onChange={e=>setRecruiterId(e.target.value)} required>
            <option value="">בחרו מגייס…</option>
            {emps.map(m=><option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <span className="hint">הבונוס על השמה זו ייזקף למגייס שנבחר כאן, וייעל בהשמה. ברירת המחדל היא המגייס האחראי במועמדות.</span></label>
        {preview != null && <p className="msg ok">עמלה צפויה: {money(preview)}</p>}
        {err && <p className="msg err">{err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !agreementId || !salary || !recruiterId}>{busy ? 'יוצר…' : 'יצירת השמה'}</button>
          <button type="button" className="btn btn-quiet" onClick={()=>nav(-1)}>ביטול</button>
        </div>
      </form>
    </>
  );
}
