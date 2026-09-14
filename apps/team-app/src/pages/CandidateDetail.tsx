import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ACTIVITY_KIND, APP_STAGE, CANDIDATE_DOC_KIND, formatDate, formatDateTime, fmtSize, label, money } from '../lib/format';
import { useAuth } from '../lib/auth';
import { useLoad, unwrap } from '../lib/useLoad';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Contact from '../components/Contact';
import Dialog from '../components/Dialog';
import FormsPanel from '../components/FormsPanel';
import CvAnalysis from '../components/CvAnalysis';
import { Msg, Loading } from '../components/Msg';
import { CustomFieldsView } from '../components/CustomFields';

interface Candidate {
  id: string; full_name: string; phone_raw: string | null; email: string | null;
  years_experience: number | null; skills: string[] | null; desired_salary: number | null;
  availability: string | null; source: string | null; created_at: string;
  custom?: Record<string, unknown> | null;
}
interface Appl { id: string; stage: string; stage_changed_at: string; jobs: { title: string } | null }
interface Doc { id: string; kind: string; file_name: string; storage_path: string; size_bytes: number; created_at: string }
interface Activity { id: string; kind: string; body: string | null; occurred_at: string; actor: { full_name: string } | null }
interface FormInst { id: string; status: string; sent_at: string | null; completed_at: string | null; created_at: string; form_templates: { name: string } | null }

export default function CandidateDetail() {
  const { id } = useParams();
  const { employee } = useAuth();
  const meId = employee?.id ?? null;
  const [docErr, setDocErr] = useState('');

  const { data, err, loading, reload } = useLoad(async () => {
    const cand = unwrap(await supabase.from('candidates')
      .select('id, full_name, phone_raw, email, years_experience, skills, desired_salary, availability, source, created_at, custom')
      .eq('id', id).maybeSingle()) as Candidate | null;
    if (!cand) throw { code: 'PGRST116', message: 'candidate not found' };
    const [ar, dr, actr, fr] = await Promise.all([
      supabase.from('applications').select('id, stage, stage_changed_at, jobs(title)').eq('candidate_id', id).order('stage_changed_at', { ascending: false }),
      supabase.from('documents').select('id, kind, file_name, storage_path, size_bytes, created_at').eq('candidate_id', id).order('created_at', { ascending: false }),
      supabase.from('activities').select('id, kind, body, occurred_at, actor:employees(full_name)').eq('entity_type', 'candidate').eq('entity_id', id).order('occurred_at', { ascending: false }),
      supabase.from('form_instances').select('id, status, sent_at, completed_at, created_at, form_templates(name)').eq('entity_type', 'candidate').eq('entity_id', id).order('created_at', { ascending: false }),
    ]);
    return {
      cand, apps: unwrap(ar) as unknown as Appl[], docs: unwrap(dr) as Doc[],
      activities: unwrap(actr) as unknown as Activity[], forms: unwrap(fr) as unknown as FormInst[],
    };
  }, [id]);

  async function openDoc(d: Doc) {
    setDocErr('');
    const { data: signed, error } = await supabase.storage.from('candidate-docs').createSignedUrl(d.storage_path, 120);
    if (error || !signed?.signedUrl) { setDocErr(toUserMessage(error, 'פתיחת המסמך נכשלה. ייתכן שהקובץ הוסר מהאחסון.')); return; }
    window.open(signed.signedUrl, '_blank', 'noopener');
  }

  if (loading) return <Loading />;
  if (err || !data) return <Msg kind="err">{err || 'המועמד לא נמצא.'}</Msg>;
  const { cand: c, apps, docs, activities, forms } = data;

  return (
    <>
      <PageHead title={c.full_name} sub="כרטיס מועמד"
        action={<>
          <Link to={`/candidates/${c.id}/edit`} className="btn btn-quiet btn-sm">עריכה</Link>
          <Link to={`/applications/new?candidate=${c.id}`} className="btn btn-primary btn-sm">+ מועמדות למשרה</Link>
        </>} />
      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">פרטים</h2>
          <dl className="dl">
            <dt>טלפון</dt><dd><Contact kind="phone" value={c.phone_raw} /></dd>
            <dt>דוא״ל</dt><dd><Contact kind="email" value={c.email} /></dd>
            <dt>כישורים</dt><dd>{c.skills?.length ? c.skills.join(', ') : '—'}</dd>
            <dt>ניסיון</dt><dd>{c.years_experience != null ? `${c.years_experience} שנים` : '—'}</dd>
            <dt>שכר רצוי</dt><dd>{money(c.desired_salary, 'ILS', 0)}</dd>
            <dt>זמינות</dt><dd>{c.availability ?? '—'}</dd>
            <dt>מקור</dt><dd>{c.source ?? '—'}</dd>
            <dt>נוצר</dt><dd>{formatDate(c.created_at)}</dd>
          </dl>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">מועמדויות ({apps.length})</h2>
          {apps.length === 0 ? <p className="hint">אין מועמדויות. אפשר לפתוח מועמדות למשרה.</p> : (
            <ul className="linklist">
              {apps.map(a => (
                <li key={a.id}>
                  <Link to={`/applications/${a.id}`}>
                    <span>{a.jobs?.title ?? 'משרה'}</span>
                    <span className="tag brand">{label(APP_STAGE, a.stage)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div style={{ marginTop: 16 }}><CustomFieldsView entityType="candidate" values={c.custom} /></div>
      <div className="card" style={{ padding: 20, marginTop: 16 }}>
        <h2 className="sec">מסמכים ({docs.length})</h2>
        <Msg kind="err">{docErr}</Msg>
        {docs.length === 0 ? <p className="hint">אין מסמכים.</p> : (
          <ul className="linklist">
            {docs.map(d => (
              <li key={d.id}>
                {/* היה <a href="#"> — כפתור אמיתי, נגיש למקלדת ולקוראי מסך. */}
                <button type="button" className="linkrow" onClick={() => openDoc(d)}>
                  <span>📄 {d.file_name}</span>
                  <span className="hint">{label(CANDIDATE_DOC_KIND, d.kind)} · {fmtSize(d.size_bytes)} · {formatDate(d.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <CvAnalysis candidateId={id!} docs={docs}
          candidate={{ full_name: c.full_name, email: c.email, phone_raw: c.phone_raw,
            years_experience: c.years_experience, skills: c.skills,
            desired_salary: c.desired_salary, availability: c.availability }}
          onChange={reload} />
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <Activities candId={id!} meId={meId} rows={activities} onChange={reload} />
        <FormsPanel entityKey="candidate" entityId={id!} recipient={{ name: c.full_name, email: c.email, phone: c.phone_raw }} rows={forms} onSent={reload} emptyText="לא נשלחו טפסים למועמד." />
      </div>
      <style>{`
        .cd-row { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); align-items: start; }
        .cd-row:last-child { border-bottom: 0; }
        .cd-row .row-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
      `}</style>
    </>
  );
}

// יומן התקשרויות ופעילות מול המועמד: שיחות, פגישות, הודעות, הערות.
function Activities({ candId, meId, rows, onChange }:
  { candId: string; meId: string | null; rows: Activity[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('call'); const [body, setBody] = useState(''); const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [del, setDel] = useState<Activity | null>(null); const [delBusy, setDelBusy] = useState(false);

  async function add(e: FormEvent) {
    e.preventDefault(); setErr('');
    const occurred = when ? new Date(when) : new Date();
    if (Number.isNaN(occurred.getTime())) { setErr('מועד ההתקשרות אינו תקין.'); return; }
    setBusy(true);
    const { error } = await supabase.from('activities').insert({
      kind, entity_type: 'candidate', entity_id: candId, body: body.trim() || null,
      actor_id: meId, occurred_at: occurred.toISOString(),
    });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת ההתקשרות נכשלה.')); return; }
    setOpen(false); setBody(''); setWhen(''); setKind('call'); onChange();
  }

  async function remove() {
    if (!del) return;
    setDelBusy(true); setErr('');
    const { error } = await supabase.from('activities').delete().eq('id', del.id);
    setDelBusy(false); setDel(null);
    if (error) { setErr(toUserMessage(error, 'מחיקת ההתקשרות נכשלה.')); return; }
    onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">התקשרויות ופעילות ({rows.length})</h2>
      <Msg kind="err">{err}</Msg>
      {rows.length === 0 ? <p className="hint">אין עדיין תיעוד התקשרויות.</p> : rows.map(a => (
        <div key={a.id} className="cd-row">
          <span>
            <span className="tag mute">{label(ACTIVITY_KIND, a.kind)}</span>{' '}
            {a.body || '—'}
            <span className="hint" style={{ display: 'block' }}>{formatDateTime(a.occurred_at)}{a.actor?.full_name ? ' · ' + a.actor.full_name : ''}</span>
          </span>
          <span className="row-actions">
            <button type="button" className="iconbtn" onClick={() => setDel(a)} aria-label="מחיקת התקשרות">🗑</button>
          </span>
        </div>
      ))}
      {open ? (
        <form onSubmit={add} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label><span className="lbl">סוג</span>
            <select value={kind} onChange={e => setKind(e.target.value)}>
              {Object.entries(ACTIVITY_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label><span className="lbl">מתי</span>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} /></label>
          <label><span className="lbl">תיאור</span>
            <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="תוכן השיחה, סיכום הפגישה…" /></label>
          <Msg kind="err">{err}</Msg>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>שמירה</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>ביטול</button>
          </div>
        </form>
      ) : <button className="btn btn-quiet btn-sm" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>+ תיעוד התקשרות</button>}

      <Dialog open={!!del} title="מחיקת התקשרות" onClose={() => setDel(null)}
        description={del ? label(ACTIVITY_KIND, del.kind) + ' · ' + formatDateTime(del.occurred_at) : undefined}
        footer={<>
          <button className="btn btn-danger" disabled={delBusy} onClick={remove}>{delBusy ? 'מוחק…' : 'מחיקה'}</button>
          <button className="btn btn-quiet" onClick={() => setDel(null)}>ביטול</button>
        </>}>
        <p>התיעוד יימחק לצמיתות.</p>
      </Dialog>
    </div>
  );
}

