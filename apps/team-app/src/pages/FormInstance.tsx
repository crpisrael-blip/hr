import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import { FORM_BASE } from './Forms';
import { tableForEntity } from '../lib/entities';
import PageHead from '../components/PageHead';

const FSTATUS: [string,string][] = [['created','נוצר'],['sent','נשלח'],['opened','נפתח'],['started','התחיל מילוי'],['completed','הושלם']];

export default function FormInstance() {
  const { id } = useParams();
  const [i, setI] = useState<any>(null);
  const [t, setT] = useState<any>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState('');

  async function load() {
    const r = await supabase.from('form_instances').select('*').eq('id', id).maybeSingle();
    if (r.error || !r.data) { setErr('המופע לא נמצא'); return; }
    setI(r.data);
    const tr = await supabase.from('form_templates').select('name, definition, field_map, filing_target, filing_category').eq('id', r.data.template_id).maybeSingle();
    if (!tr.error) setT(tr.data);
  }
  useEffect(() => { load(); }, [id]);

  if (err) return <p className="msg err">{err}</p>;
  if (!i || !t) return <p className="spinner">טוען…</p>;

  const fields = (t.definition?.fields ?? []).slice().sort((a:any,b:any)=>(a.order??0)-(b.order??0));
  const answers = i.answers ?? {};
  const link = `${FORM_BASE}/f/${i.token}`;
  const tblFor = (e: string) => tableForEntity(e);

  async function markSent() { await supabase.from('form_instances').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', id); load(); }

  async function applyMap(m: any) {
    setNote('');
    const tbl = tblFor(i.entity_type);
    if (!tbl || !i.entity_id) { setNote('אין קישור לתיק — לא ניתן לעדכן.'); return; }
    if (tbl !== m.table) { setNote(`המיפוי הוא ל-${m.table} אך הטופס מקושר ל-${i.entity_type}.`); return; }
    let val = answers[m.field_key];
    if (Array.isArray(val)) val = val.join(', ');
    const { error } = await supabase.from(m.table).update({ [m.column]: val }).eq('id', i.entity_id);
    if (error) { setNote('עדכון נכשל: ' + error.message); return; }
    await supabase.from('form_instances').update({ applied_at: new Date().toISOString() }).eq('id', id);
    setNote(`עודכן: ${m.column}`); load();
  }

  const valDisplay = (v: any) => v == null || v === '' ? '—'
    : Array.isArray(v) ? v.join(', ')
    : typeof v === 'boolean' ? (v ? 'כן' : 'לא')
    : (typeof v === 'string' && v.startsWith('data:image')) ? '(חתימה/תמונה)' : String(v);

  return (
    <>
      <PageHead title={t.name} sub={`נמען: ${i.recipient_name ?? '—'}`} />
      {note && <p className="msg ok">{note}</p>}
      <div className="grid2">
        <div style={{ display:'grid', gap:16 }}>
          <div className="card" style={{ padding:20 }}>
            <h2 className="sec">מצב הטופס</h2>
            <ol className="steps">
              {FSTATUS.map(([k,l]) => {
                const ts = i[k==='created'?'created_at':k==='sent'?'sent_at':k==='opened'?'opened_at':k==='started'?'started_at':'completed_at'];
                const done = !!ts || (k==='created');
                return <li key={k} className={done?'on':''}><span>{done?'✓':'○'} {l}</span><span className="hint">{ts?formatDate(ts):''}</span></li>;
              })}
            </ol>
            <label style={{ marginTop:12 }}><span className="lbl">קישור למילוי</span><input readOnly dir="ltr" value={link} onFocus={e=>e.target.select()} /></label>
            <div style={{ display:'flex', gap:8, marginTop:8 }}>
              <button className="btn btn-quiet btn-sm" onClick={()=>navigator.clipboard.writeText(link)}>📋 העתקה</button>
              {i.status==='created' && <button className="btn btn-quiet btn-sm" onClick={markSent}>סמן כנשלח</button>}
            </div>
          </div>

          {(t.field_map ?? []).length > 0 && (
            <div className="card" style={{ padding:20 }}>
              <h2 className="sec">עדכון המערכת</h2>
              {i.status!=='completed' ? <p className="hint">זמין לאחר שהטופס יושלם.</p> : (
                <div style={{ display:'grid', gap:8 }}>
                  {t.field_map.map((m:any, n:number) => {
                    const f = fields.find((x:any)=>x.key===m.field_key);
                    return <div key={n} className="maprow">
                      <span>{f?.label ?? m.field_key} → <code dir="ltr">{m.table}.{m.column}</code><br/><span className="hint">ערך: {valDisplay(answers[m.field_key])} · {m.mode==='auto'?'אוטומטי':'לאישור'}</span></span>
                      <button className="btn btn-quiet btn-sm" onClick={()=>applyMap(m)}>עדכן</button>
                    </div>;
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card" style={{ padding:20 }}>
          <h2 className="sec">תשובות</h2>
          {i.status!=='completed' && <p className="hint" style={{ marginBottom:10 }}>הטופס עדיין לא הושלם — מוצגות תשובות חלקיות.</p>}
          <dl className="dl">
            {fields.filter((f:any)=>!['heading','paragraph'].includes(f.type)).map((f:any)=>(
              <div key={f.key} style={{ display:'contents' }}><dt>{f.label}</dt><dd>{valDisplay(answers[f.key])}</dd></div>
            ))}
          </dl>
        </div>
      </div>
      <style>{`
        .grid2 { display:grid; gap:16px; grid-template-columns:1fr 1.2fr; align-items:start; }
        .sec { font-size:1.05rem; margin-bottom:12px; }
        .steps { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
        .steps li { display:flex; justify-content:space-between; color:var(--ink-soft); }
        .steps li.on { color:var(--ink); font-weight:600; }
        .dl { display:grid; grid-template-columns:150px 1fr; gap:8px 12px; margin:0; }
        .dl dt { color:var(--ink-soft); font-size:.88rem; } .dl dd { margin:0; }
        .maprow { display:flex; justify-content:space-between; align-items:center; gap:10px; border:1px solid var(--line); border-radius:9px; padding:8px 10px; }
        @media (max-width:820px){ .grid2 { grid-template-columns:1fr; } }
      `}</style>
    </>
  );
}
