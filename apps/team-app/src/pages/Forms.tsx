import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

export const FORM_BASE = 'https://my.hr.ort-tech.co.il';
const RECIPIENT: Record<string,string> = { candidate:'מועמד', staff:'מגייס/עובד', client:'לקוח', general:'כללי' };
const FSTATUS: Record<string,string> = { created:'נוצר', sent:'נשלח', opened:'נפתח', started:'במילוי', completed:'הושלם' };
const TSTATUS: Record<string,string> = { draft:'טיוטה', active:'פעיל', archived:'ארכיון' };

export default function Forms() {
  const [tab, setTab] = useState<'templates'|'instances'>('templates');
  const [tpls, setTpls] = useState<any[]>([]);
  const [insts, setInsts] = useState<any[]>([]);
  const [sendFor, setSendFor] = useState<string>('');

  async function load() {
    const [t, i] = await Promise.all([
      supabase.from('form_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('form_instances').select('id, status, recipient_name, recipient_type, entity_type, created_at, template_id, form_templates(name)').order('created_at', { ascending: false }).limit(200),
    ]);
    if (!t.error) setTpls(t.data); if (!i.error) setInsts(i.data);
  }
  useEffect(() => { load(); }, []);

  return (
    <>
      <PageHead title="טפסים" sub="בונה טפסים דינמיים, שליחה, מעקב ותיוק"
        action={<Link to="/forms/new" className="btn btn-primary btn-sm">+ טופס חדש</Link>} />
      <div className="tabs">
        <button className={tab==='templates'?'on':''} onClick={()=>setTab('templates')}>תבניות ({tpls.length})</button>
        <button className={tab==='instances'?'on':''} onClick={()=>setTab('instances')}>נשלחו ({insts.length})</button>
      </div>

      {tab==='templates' && (
        tpls.length===0 ? <div className="card empty">אין עדיין טפסים. צרו טופס ראשון.</div> : (
          <div style={{ display:'grid', gap:12 }}>
            {tpls.map(t => (
              <div key={t.id} className="card" style={{ padding:16 }}>
                <div className="spread">
                  <div>
                    <h2 style={{ margin:0, fontSize:'1.05rem' }}>{t.name}</h2>
                    <div className="hint">{RECIPIENT[t.recipient_type]} · {(t.definition?.fields?.length ?? 0)} שדות · <span className={'tag '+(t.status==='active'?'ok':'mute')}>{TSTATUS[t.status]}</span></div>
                  </div>
                  <div style={{ display:'flex', gap:6 }}>
                    <Link to={`/forms/${t.id}`} className="btn btn-quiet btn-sm">✏️ עריכה</Link>
                    <button className="btn btn-primary btn-sm" onClick={()=>setSendFor(sendFor===t.id?'':t.id)}>שליחה</button>
                  </div>
                </div>
                {sendFor===t.id && <SendPanel template={t} onDone={()=>{ setSendFor(''); load(); setTab('instances'); }} />}
              </div>
            ))}
          </div>
        )
      )}

      {tab==='instances' && (
        insts.length===0 ? <div className="card empty">לא נשלחו טפסים עדיין.</div> : (
          <div className="card" style={{ overflow:'hidden' }}>
            <table>
              <thead><tr><th>טופס</th><th>נמען</th><th>סוג</th><th>מצב</th><th>נוצר</th></tr></thead>
              <tbody>{insts.map(i => (
                <tr key={i.id}>
                  <td style={{ fontWeight:600 }}><Link to={`/forms/instances/${i.id}`}>{i.form_templates?.name ?? 'טופס'}</Link></td>
                  <td>{i.recipient_name ?? '—'}</td><td>{RECIPIENT[i.recipient_type]}</td>
                  <td><span className={'tag '+(i.status==='completed'?'ok':'brand')}>{FSTATUS[i.status]}</span></td>
                  <td className="num">{formatDate(i.created_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )
      )}
      <style>{`
        .tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--line); }
        .tabs button { background:none; border:none; padding:10px 14px; cursor:pointer; color:var(--ink-mid); font-weight:600; border-bottom:2px solid transparent; }
        .tabs button.on { color:var(--brand-ink); border-bottom-color:var(--accent); }
        .spread { display:flex; justify-content:space-between; align-items:center; gap:10px; }
      `}</style>
    </>
  );
}

function SendPanel({ template, onDone }: { template: any; onDone: () => void }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [entityType, setEntityType] = useState(template.filing_target && ['candidate','employee','company'].includes(template.filing_target) ? template.filing_target : '');
  const [entities, setEntities] = useState<any[]>([]); const [entityId, setEntityId] = useState('');
  const [link, setLink] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  useEffect(() => {
    if (!entityType) { setEntities([]); return; }
    const tbl = entityType === 'candidate' ? 'candidates' : entityType === 'employee' ? 'employees' : 'companies';
    const col = entityType === 'company' ? 'name' : 'full_name';
    supabase.from(tbl).select(`id, ${col}`).order(col).limit(500).then(r => { if (!r.error) setEntities(r.data.map((x:any)=>({ id:x.id, name:x[col] }))); });
  }, [entityType]);

  async function create() {
    setBusy(true); setErr('');
    const { data, error } = await supabase.from('form_instances').insert({
      template_id: template.id, recipient_type: template.recipient_type,
      recipient_name: name.trim() || null, recipient_email: email.trim() || null, recipient_phone: phone.trim() || null,
      entity_type: entityType || null, entity_id: entityId || null,
      filing_category: template.filing_category ?? null, status: 'created',
    }).select('token').single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setLink(`${FORM_BASE}/f/${data!.token}`);
  }

  const waText = encodeURIComponent(`שלום${name?' '+name:''}, נא למלא את הטופס: ${link}`);

  return (
    <div style={{ borderTop:'1px solid var(--line)', marginTop:12, paddingTop:12, display:'grid', gap:10 }}>
      {!link ? <>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
          <label><span className="lbl">שם הנמען</span><input value={name} onChange={e=>setName(e.target.value)} /></label>
          <label><span className="lbl">דוא״ל</span><input type="email" dir="ltr" value={email} onChange={e=>setEmail(e.target.value)} /></label>
          <label><span className="lbl">טלפון</span><input dir="ltr" value={phone} onChange={e=>setPhone(e.target.value)} /></label>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 2fr', gap:10 }}>
          <label><span className="lbl">קישור לתיק</span><select value={entityType} onChange={e=>{setEntityType(e.target.value);setEntityId('');}}>
            <option value="">ללא</option><option value="candidate">מועמד</option><option value="employee">עובד</option><option value="company">לקוח</option></select></label>
          {entityType && <label><span className="lbl">בחר/י</span><select value={entityId} onChange={e=>setEntityId(e.target.value)}>
            <option value="">—</option>{entities.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
        </div>
        {err && <p className="msg err">{err}</p>}
        <div><button className="btn btn-primary btn-sm" disabled={busy} onClick={create}>{busy?'יוצר…':'יצירת קישור'}</button></div>
      </> : <>
        <label><span className="lbl">קישור למילוי</span><input readOnly value={link} dir="ltr" onFocus={e=>e.target.select()} /></label>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button className="btn btn-quiet btn-sm" onClick={()=>navigator.clipboard.writeText(link)}>📋 העתקה</button>
          {email && <a className="btn btn-quiet btn-sm" href={`mailto:${email}?subject=${encodeURIComponent('טופס למילוי — '+template.name)}&body=${encodeURIComponent('נא למלא: '+link)}`}>✉️ מייל</a>}
          {phone && <a className="btn btn-quiet btn-sm" href={`https://wa.me/${phone.replace(/[^\d]/g,'')}?text=${waText}`} target="_blank" rel="noopener">💬 וואטסאפ</a>}
          <button className="btn btn-primary btn-sm" onClick={onDone}>סיום</button>
        </div>
        <p className="hint">הקישור נוצר. סמן/שלח לנמען — המצב יתעדכן אוטומטית כשייפתח וימולא.</p>
      </>}
    </div>
  );
}
