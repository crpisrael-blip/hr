import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JOB_STAGE, SCOPE, label, slugify } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg, Loading, EmptyState } from '../components/Msg';

interface Publication {
  id: string; status: string; slug: string;
  public_title: string; public_body: string; expose_company_name: boolean; public_location: string | null;
}
interface Row {
  id: string; title: string; stage: string; location: string | null; employment_scope: string | null;
  headcount: number; companies: { name: string } | null; job_publications: Publication[] | null;
}

const PLACEHOLDER = 'תיאור המשרה יתעדכן בקרוב.';
const MIN_BODY = 40;

/** טקסט פרסום שאסור לעלות לאוויר: ריק, ברירת מחדל, או קצר מדי. */
function publicationProblem(title: string, body: string): string {
  if (!title.trim()) return 'נא להזין כותרת לפרסום.';
  const b = body.trim();
  if (!b) return 'נא להזין תיאור משרה לפרסום.';
  if (b === PLACEHOLDER) return 'התיאור הוא טקסט ברירת המחדל. יש לכתוב תיאור אמיתי לפני הפרסום.';
  if (b.length < MIN_BODY) return `התיאור קצר מדי לפרסום באתר (לפחות ${MIN_BODY} תווים).`;
  return '';
}

export default function Jobs() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<{ row: Row; publishAfter: boolean } | null>(null);

  const load = useCallback(async () => {
    const r = await supabase.from('jobs')
      .select('id, title, stage, location, employment_scope, headcount, companies(name), job_publications(id, status, slug, public_title, public_body, expose_company_name, public_location)')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (r.error) { setErr(toUserMessage(r.error, 'טעינת המשרות נכשלה.')); return; }
    const data = r.data as unknown as Row[];
    setErr(''); setRows(data); setMore(data.length >= limit);
  }, [limit]);

  useEffect(() => { load(); }, [load]);

  const publishedOf = (row: Row) => row.job_publications?.find(p => p.status === 'published') ?? null;
  const publicationOf = (row: Row) => publishedOf(row) ?? row.job_publications?.[0] ?? null;

  async function publish(row: Row) {
    const pub = publicationOf(row);
    // ★ אין פרסום קיים, או שהטקסט הוא ברירת המחדל — פותחים עריכה במקום להעלות placeholder.
    if (!pub || publicationProblem(pub.public_title, pub.public_body)) {
      setEditing({ row, publishAfter: true });
      return;
    }
    setBusy(row.id); setErr('');
    const { error } = await supabase.from('job_publications')
      .update({ status: 'published', published_at: new Date().toISOString(), unpublished_at: null }).eq('id', pub.id);
    if (error) { setErr(toUserMessage(error, 'פרסום המשרה נכשל.')); setBusy(''); return; }
    if (row.stage === 'draft') {
      const up = await supabase.from('jobs').update({ stage: 'open' }).eq('id', row.id);
      if (up.error) setErr(toUserMessage(up.error, 'המשרה פורסמה אך עדכון שלב המשרה נכשל.'));
    }
    await load(); setBusy('');
  }

  async function unpublish(row: Row) {
    const pub = publishedOf(row);
    if (!pub) return;
    setBusy(row.id); setErr('');
    const { error } = await supabase.from('job_publications')
      .update({ status: 'unpublished', unpublished_at: new Date().toISOString() }).eq('id', pub.id);
    if (error) setErr(toUserMessage(error, 'הסרת הפרסום נכשלה.'));
    await load(); setBusy('');
  }

  return (
    <>
      <PageHead title="משרות" sub="משרות פנימיות ומצב הפרסום שלהן"
        action={<Link to="/jobs/new" className="btn btn-primary btn-sm">+ משרה חדשה</Link>} />
      <Msg kind="err">{err}</Msg>
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <EmptyState>אין עדיין משרות.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="record-grid">
          {rows.map(r => {
            const pub = publishedOf(r);
            const draft = publicationOf(r);
            return (
              <article className="card record-card" key={r.id}>
                <header>
                  <span className="tag brand">{label(JOB_STAGE, r.stage)}</span>
                  {pub ? <span className="tag ok">מפורסמת</span> : <span className="tag">לא מפורסמת</span>}
                </header>
                <h2><Link to={`/jobs/${r.id}`}>{r.title}</Link></h2>
                <dl>
                  <dt>חברה</dt><dd>{r.companies?.name ?? '—'}</dd>
                  <dt>מיקום</dt><dd>{r.location ?? '—'}</dd>
                  <dt>היקף</dt><dd>{r.employment_scope ? label(SCOPE, r.employment_scope) : '—'}</dd>
                  <dt>טקסט לאתר</dt><dd>{draft && !publicationProblem(draft.public_title, draft.public_body) ? 'מוכן' : 'חסר / ברירת מחדל'}</dd>
                </dl>
                <footer>
                  <span className="hint">{r.headcount} תקנים</span>
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link to={`/jobs/${r.id}/edit`} className="btn btn-quiet btn-sm">עריכת המשרה</Link>
                    <button className="btn btn-quiet btn-sm" onClick={() => setEditing({ row: r, publishAfter: false })}>עריכת הפרסום</button>
                    {pub
                      ? <button className="btn btn-quiet btn-sm" disabled={busy === r.id} onClick={() => unpublish(r)}>הסרה מהאתר</button>
                      : <button className="btn btn-primary btn-sm" disabled={busy === r.id} onClick={() => publish(r)}>{busy === r.id ? 'מפרסם…' : 'פרסום'}</button>}
                  </span>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד משרות</button>
        </div>
      )}
      <p className="hint" style={{ marginTop: 12 }}>פרסום משרה יופיע באתר הציבורי לאחר בנייה מחדש של האתר.</p>

      {editing && (
        <PublicationDialog job={editing.row} publication={publicationOf(editing.row)}
          publishAfter={editing.publishAfter}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
    </>
  );
}

/** עריכת הטקסט שעולה לאתר הציבורי — לא היה שום מסך לכך עד כה. */
function PublicationDialog({ job, publication, publishAfter, onClose, onSaved }:
  { job: Row; publication: Publication | null; publishAfter: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    public_title: publication?.public_title || job.title,
    public_body: publication && publication.public_body !== PLACEHOLDER ? publication.public_body : '',
    public_location: publication?.public_location ?? job.location ?? '',
    expose_company_name: publication?.expose_company_name ?? false,
  });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function save() {
    const problem = publicationProblem(f.public_title, f.public_body);
    if (problem) { setErr(problem); return; }
    setBusy(true); setErr('');
    const body = {
      public_title: f.public_title.trim(),
      public_body: f.public_body.trim(),
      public_location: f.public_location.trim() || null,
      expose_company_name: f.expose_company_name,
      ...(publishAfter ? { status: 'published', published_at: new Date().toISOString(), unpublished_at: null } : {}),
    };
    const res = publication
      ? await supabase.from('job_publications').update(body).eq('id', publication.id)
      : await supabase.from('job_publications').insert({
        ...body, job_id: job.id, slug: slugify(f.public_title),
        status: publishAfter ? 'published' : 'draft',
        published_at: publishAfter ? new Date().toISOString() : null,
      });
    if (res.error) { setErr(toUserMessage(res.error, 'שמירת הפרסום נכשלה.')); setBusy(false); return; }
    if (publishAfter && job.stage === 'draft') await supabase.from('jobs').update({ stage: 'open' }).eq('id', job.id);
    setBusy(false);
    onSaved();
  }

  return (
    <Dialog open wide title="הטקסט שמופיע באתר" onClose={onClose} onSubmit={save}
      description={`${job.title}${job.companies?.name ? ' · ' + job.companies.name : ''}`}
      footer={<>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'שומר…' : publishAfter ? 'שמירה ופרסום' : 'שמירה'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>ביטול</button>
      </>}>
      <label><span className="lbl">כותרת באתר *</span>
        <input value={f.public_title} onChange={e => setF(s => ({ ...s, public_title: e.target.value }))} required /></label>
      <label><span className="lbl">תיאור המשרה באתר *</span>
        <textarea rows={7} value={f.public_body} onChange={e => setF(s => ({ ...s, public_body: e.target.value }))} required />
        <span className="hint">הטקסט הזה נראה למועמדים. לפחות {MIN_BODY} תווים, בלי טקסט ברירת מחדל.</span></label>
      <label><span className="lbl">מיקום לתצוגה</span>
        <input value={f.public_location} onChange={e => setF(s => ({ ...s, public_location: e.target.value }))} placeholder="תל אביב / היברידי" /></label>
      <label style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={f.expose_company_name} style={{ width: 18, height: 18 }}
          onChange={e => setF(s => ({ ...s, expose_company_name: e.target.checked }))} />
        <span>חשיפת שם החברה באתר</span>
      </label>
      <Msg kind="err">{err}</Msg>
    </Dialog>
  );
}
