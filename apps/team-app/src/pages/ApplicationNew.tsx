import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg } from '../components/Msg';

interface Opt { id: string; label: string; }

export default function ApplicationNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { employee } = useAuth();
  const [candidates, setCandidates] = useState<Opt[]>([]);
  const [jobs, setJobs] = useState<Opt[]>([]);
  const [candidateId, setCandidateId] = useState(sp.get('candidate') ?? '');
  const [jobId, setJobId] = useState(sp.get('job') ?? '');
  const [source, setSource] = useState('ידני');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from('candidates').select('id, full_name').order('created_at', { ascending: false }).limit(500)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת המועמדים נכשלה.')); return; }
        setCandidates((r.data as { id: string; full_name: string }[]).map(c => ({ id: c.id, label: c.full_name })));
      });
    supabase.from('jobs').select('id, title, companies(name)').in('stage', ['open', 'on_hold', 'draft'])
      .order('created_at', { ascending: false }).limit(500)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת המשרות נכשלה.')); return; }
        const rows = r.data as unknown as { id: string; title: string; companies: { name: string } | null }[];
        setJobs(rows.map(j => ({ id: j.id, label: j.companies?.name ? `${j.title} — ${j.companies.name}` : j.title })));
      });
    return () => { alive = false; };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    // מזהה העובד כבר קיים ב-useAuth — אין צורך בסיבוב נוסף ל-auth.getUser + employees.
    const { data, error } = await supabase.from('applications').insert({
      candidate_id: candidateId, job_id: jobId, source: source.trim() || null,
      recruiter_id: employee?.id ?? null, stage: 'new',
    }).select('id').single();
    setBusy(false);
    if (error) {
      setErr(error.code === '23505' ? 'כבר קיימת מועמדות של המועמד הזה למשרה הזו.' : toUserMessage(error, 'פתיחת המועמדות נכשלה.'));
      return;
    }
    nav(`/applications/${data!.id}`);
  }

  return (
    <>
      <PageHead title="מועמדות חדשה" sub="שיוך מועמד למשרה" />
      <form className="card" style={{ padding: 24, maxWidth: 560, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">מועמד *</span>
          <select value={candidateId} onChange={e => setCandidateId(e.target.value)} required>
            <option value="">בחרו מועמד…</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select></label>
        <label><span className="lbl">משרה *</span>
          <select value={jobId} onChange={e => setJobId(e.target.value)} required>
            <option value="">בחרו משרה…</option>
            {jobs.map(j => <option key={j.id} value={j.id}>{j.label}</option>)}
          </select></label>
        <label><span className="lbl">מקור</span>
          <input value={source} onChange={e => setSource(e.target.value)} /></label>
        <Msg kind="err">{err}</Msg>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !candidateId || !jobId}>{busy ? 'שומר…' : 'פתיחת מועמדות'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav(-1)}>ביטול</button>
        </div>
      </form>
    </>
  );
}
