import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import PageHead from '../components/PageHead';

interface Counts { companies: number; jobsOpen: number; candidates: number; appsActive: number; tasksOpen: number; }

export default function Dashboard() {
  const { employee } = useAuth();
  const [c, setC] = useState<Counts | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const count = (q: any) => q.then((r: any) => { if (r.error) throw r.error; return r.count ?? 0; });
        const [companies, jobsOpen, candidates, appsActive, tasksOpen] = await Promise.all([
          count(supabase.from('companies').select('*', { count: 'exact', head: true })),
          count(supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('stage', 'open')),
          count(supabase.from('candidates').select('*', { count: 'exact', head: true })),
          count(supabase.from('applications').select('*', { count: 'exact', head: true })
            .not('stage', 'in', '(hired,rejected,withdrawn,job_cancelled)')),
          count(supabase.from('tasks').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress'])),
        ]);
        setC({ companies, jobsOpen, candidates, appsActive, tasksOpen });
      } catch (e: any) { setErr(e.message ?? 'שגיאה בטעינת הנתונים'); }
    })();
  }, []);

  const tiles = c ? [
    { label: 'חברות', value: c.companies, to: '/companies' },
    { label: 'משרות פתוחות', value: c.jobsOpen, to: '/jobs' },
    { label: 'מועמדים', value: c.candidates, to: '/candidates' },
    { label: 'מועמדויות פעילות', value: c.appsActive, to: '/applications' },
    { label: 'משימות פתוחות', value: c.tasksOpen, to: '/tasks' },
  ] : [];

  return (
    <>
      <PageHead title={`שלום, ${employee?.full_name?.split(' ')[0] ?? ''}`} sub="תמונת מצב של הגיוס" />
      {err && <p className="msg err">{err}</p>}
      {!c && !err && <p className="spinner">טוען…</p>}
      {c && (
        <div className="tiles">
          {tiles.map(t => (
            <Link key={t.to} to={t.to} className="card tile">
              <span className="tile-val">{t.value}</span>
              <span className="tile-lbl">{t.label}</span>
            </Link>
          ))}
        </div>
      )}
      <div className="quick card">
        <h2 style={{ fontSize: '1.05rem', marginBottom: 4 }}>פעולות מהירות</h2>
        <p className="hint" style={{ marginBottom: 12 }}>הדרך המהירה להתחיל: הקימו חברה, ואז משרה, ופרסמו אותה לאתר.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link to="/companies/new" className="btn btn-primary btn-sm">+ חברה חדשה</Link>
          <Link to="/jobs/new" className="btn btn-quiet btn-sm">+ משרה חדשה</Link>
        </div>
      </div>
      <style>{`
        .tiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 20px; }
        .tile { padding: 20px; display: flex; flex-direction: column; gap: 4px; text-decoration: none; color: inherit; transition: border-color .13s, transform .13s; }
        .tile:hover { border-color: var(--line-strong); transform: translateY(-2px); }
        .tile-val { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .tile-lbl { color: var(--ink-mid); font-size: .9rem; }
        .quick { padding: 20px; }
      `}</style>
    </>
  );
}
