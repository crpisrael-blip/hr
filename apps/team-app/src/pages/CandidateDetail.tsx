import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { APP_STAGE, CANDIDATE_DOC_KIND, formatDate, fmtSize, label, money } from '../lib/format';
import { useLoad, unwrap } from '../lib/useLoad';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Contact from '../components/Contact';
import { Msg, Loading } from '../components/Msg';
import { CustomFieldsView } from '../components/CustomFields';

interface Candidate {
  id: string; full_name: string; phone_raw: string | null; email: string | null;
  skills: string[] | null; desired_salary: number | null; availability: string | null;
  source: string | null; created_at: string; custom?: Record<string, unknown> | null;
}
interface Appl { id: string; stage: string; stage_changed_at: string; jobs: { title: string } | null }
interface Doc { id: string; kind: string; file_name: string; storage_path: string; size_bytes: number; created_at: string }

export default function CandidateDetail() {
  const { id } = useParams();
  const [docErr, setDocErr] = useState('');

  const { data, err, loading } = useLoad(async () => {
    const cand = unwrap(await supabase.from('candidates')
      .select('id, full_name, phone_raw, email, skills, desired_salary, availability, source, created_at, custom')
      .eq('id', id).maybeSingle()) as Candidate | null;
    if (!cand) throw { code: 'PGRST116', message: 'candidate not found' };
    const [ar, dr] = await Promise.all([
      supabase.from('applications').select('id, stage, stage_changed_at, jobs(title)').eq('candidate_id', id).order('stage_changed_at', { ascending: false }),
      supabase.from('documents').select('id, kind, file_name, storage_path, size_bytes, created_at').eq('candidate_id', id).order('created_at', { ascending: false }),
    ]);
    return { cand, apps: unwrap(ar) as unknown as Appl[], docs: unwrap(dr) as Doc[] };
  }, [id]);

  async function openDoc(d: Doc) {
    setDocErr('');
    const { data: signed, error } = await supabase.storage.from('candidate-docs').createSignedUrl(d.storage_path, 120);
    if (error || !signed?.signedUrl) { setDocErr(toUserMessage(error, 'פתיחת המסמך נכשלה. ייתכן שהקובץ הוסר מהאחסון.')); return; }
    window.open(signed.signedUrl, '_blank', 'noopener');
  }

  if (loading) return <Loading />;
  if (err || !data) return <Msg kind="err">{err || 'המועמד לא נמצא.'}</Msg>;
  const { cand: c, apps, docs } = data;

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
    </>
  );
}
