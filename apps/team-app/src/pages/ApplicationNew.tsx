import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PageHead from '../components/PageHead';

interface Opt { id: string; label: string; }

export default function ApplicationNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [candidates, setCandidates] = useState<Opt[]>([]);
  const [jobs, setJobs] = useState<Opt[]>([]);
  const [candidateId, setCandidateId] = useState(sp.get('candidate') ?? '');
  const [jobId, setJobId] = useState(sp.get('job') ?? '');
  const [source, setSource] = useState('ידני');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('candidates').select('id, full_name').order('created_at', { ascending: false }).limit(500)
      .then(r => { if (!r.error) setCandidates((r.data as any[]).map(c => ({ id: c.id, label: c.full_name }))); });
    supabase.from('jobs').select('id, title, companies(name)').in('stage', ['open', 'on_hold', 'draft']).order('created_at', { ascending: false })
      .then(r => { if (!r.error) setJobs((r.data as any[]).map(j => ({ id: j.id, label: j.companies?.name ? `${j.title} — ${j.companies.name}` : j.title }))); });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { data: emp } = await supabase.from('employees').select('id').eq('user_id', (await supabase.auth.getUser()).data.user?.id).maybeSingle();
    const { data, error } = await supabase.from('applications').insert({
      candidate_id: candidateId, job_id: jobId, source: source.trim() || null,
      recruiter_id: emp?.id ?? null, stage: 'new',
    }).select('id').single();
    setBusy(false);
    if (error) {
      setErr(error.code === '23505' ? 'כבר קיימת מועמדות של המועמד הזה למשרה הזו.' : error.message);
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
        {err && <p className="msg err">{err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy || !candidateId || !jobId}>{busy ? 'שומר…' : 'פתיחת מועמדות'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav(-1)}>ביטול</button>
        </div>
      </form>
    </>
  );
}
