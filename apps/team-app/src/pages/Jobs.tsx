import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JOB_STAGE, SCOPE, slugify } from '../lib/format';
import PageHead from '../components/PageHead';

interface Row {
  id: string; title: string; stage: string; location: string | null; employment_scope: string | null;
  headcount: number; companies: { name: string } | null;
  job_publications: { id: string; status: string }[];
}

export default function Jobs() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const r = await supabase.from('jobs')
      .select('id, title, stage, location, employment_scope, headcount, companies(name), job_publications(id, status)')
      .order('created_at', { ascending: false });
    if (r.error) setErr(r.error.message); else setRows(r.data as any);
  }
  useEffect(() => { load(); }, []);

  function isPublished(row: Row) {
    return row.job_publications?.some(p => p.status === 'published');
  }

  async function publish(row: Row) {
    setBusy(row.id); setErr('');
    try {
      const existing = row.job_publications?.[0];
      if (existing) {
        const { error } = await supabase.from('job_publications')
          .update({ status: 'published', published_at: new Date().toISOString() }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('job_publications').insert({
          job_id: row.id, slug: slugify(row.title), public_title: row.title,
          public_body: 'תיאור המשרה יתעדכן בקרוב.', status: 'published',
          published_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      if (row.stage === 'draft') await supabase.from('jobs').update({ stage: 'open' }).eq('id', row.id);
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(''); }
  }

  async function unpublish(row: Row) {
    setBusy(row.id); setErr('');
    const pub = row.job_publications?.find(p => p.status === 'published');
    if (pub) {
      const { error } = await supabase.from('job_publications')
        .update({ status: 'unpublished', unpublished_at: new Date().toISOString() }).eq('id', pub.id);
      if (error) setErr(error.message);
    }
    await load(); setBusy('');
  }

  return (
    <>
      <PageHead title="משרות" sub="משרות פנימיות ומצב הפרסום שלהן"
        action={<Link to="/jobs/new" className="btn btn-primary btn-sm">+ משרה חדשה</Link>} />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין משרות.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead><tr><th>תפקיד</th><th>חברה</th><th>מיקום</th><th>היקף</th><th>תקנים</th><th>שלב</th><th>פרסום</th><th></th></tr></thead>
            <tbody>
              {rows.map(r => {
                const pub = isPublished(r);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.title}</td>
                    <td>{r.companies?.name ?? '—'}</td>
                    <td>{r.location ?? '—'}</td>
                    <td>{r.employment_scope ? SCOPE[r.employment_scope] : '—'}</td>
                    <td className="num">{r.headcount}</td>
                    <td><span className="tag mute">{JOB_STAGE[r.stage]}</span></td>
                    <td>{pub ? <span className="tag ok">מפורסמת</span> : <span className="tag">לא מפורסמת</span>}</td>
                    <td>{pub
                      ? <button className="btn btn-quiet btn-sm" disabled={busy===r.id} onClick={() => unpublish(r)}>הסרה</button>
                      : <button className="btn btn-primary btn-sm" disabled={busy===r.id} onClick={() => publish(r)}>{busy===r.id?'…':'פרסום'}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>פרסום משרה יופיע באתר הציבורי לאחר בנייה מחדש של האתר.</p>
    </>
  );
}
