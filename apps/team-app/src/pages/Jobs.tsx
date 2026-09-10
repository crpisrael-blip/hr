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
        <div className="record-grid">
              {rows.map(r => {
                const pub = isPublished(r);
                return (
                  <article className="card record-card" key={r.id}>
                    <header><span className="tag brand">{JOB_STAGE[r.stage]}</span>{pub ? <span className="tag ok">מפורסמת</span> : <span className="tag">לא מפורסמת</span>}</header>
                    <h2>{r.title}</h2>
                    <dl><dt>חברה</dt><dd>{r.companies?.name ?? '—'}</dd><dt>מיקום</dt><dd>{r.location ?? '—'}</dd><dt>היקף</dt><dd>{r.employment_scope ? SCOPE[r.employment_scope] : '—'}</dd></dl>
                    <footer><span className="hint">{r.headcount} תקנים</span>
                      <span style={{ display: 'flex', gap: 8 }}>
                        <Link to={`/jobs/${r.id}/edit`} className="btn btn-quiet btn-sm">✏️ עריכה</Link>
                        {pub
                          ? <button className="btn btn-quiet btn-sm" disabled={busy===r.id} onClick={() => unpublish(r)}>הסרה</button>
                          : <button className="btn btn-primary btn-sm" disabled={busy===r.id} onClick={() => publish(r)}>{busy===r.id?'…':'פרסום'}</button>}
                      </span>
                    </footer>
                  </article>
                );
              })}
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>פרסום משרה יופיע באתר הציבורי לאחר בנייה מחדש של האתר.</p>
    </>
  );
}
