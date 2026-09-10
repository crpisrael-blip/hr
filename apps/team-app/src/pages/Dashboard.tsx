import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, fin } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import Icon from '../components/Icon';
import type { ReactNode } from 'react';


interface Counts { candidates: number; jobsOpen: number; companies: number; placementsMonth: number; }

export default function Dashboard() {
  useAuth();
  const [c, setC] = useState<Counts | null>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [cands, setCands] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
        const count = (q: any) => q.then((r: any) => { if (r.error) throw r.error; return r.count ?? 0; });
        const [candidates, jobsOpen, companies, placementsMonth] = await Promise.all([
          count(supabase.from('candidates').select('*', { count: 'exact', head: true })),
          count(supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('stage', 'open')),
          count(supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'active')),
          count(fin.from('placements').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString())),
        ]);
        setC({ candidates, jobsOpen, companies, placementsMonth });
      } catch (e: any) { setErr(e.message ?? 'שגיאה'); }

      supabase.from('jobs').select('id, title, location, stage, companies(name), applications(id)')
        .in('stage', ['open','on_hold']).order('created_at', { ascending: false }).limit(5)
        .then(r => { if (!r.error) setJobs(r.data as any); });
      supabase.from('candidates').select('id, full_name, source, created_at')
        .order('created_at', { ascending: false }).limit(5)
        .then(r => { if (!r.error) setCands(r.data as any); });
      supabase.from('tasks').select('id, title, priority, due_at').in('status', ['open','in_progress'])
        .order('due_at', { ascending: true, nullsFirst: false }).limit(5)
        .then(r => { if (!r.error) setTasks(r.data as any); });
      supabase.from('interviews').select('id, scheduled_at, applications(candidates(full_name), jobs(title))')
        .gte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(5)
        .then(r => { if (!r.error) setSchedule(r.data as any); });
    })();
  }, []);

  const tiles = [
    { label: 'מועמדים במאגר', value: c?.candidates, to: '/candidates', ic: 'candidates' },
    { label: 'משרות פתוחות', value: c?.jobsOpen, to: '/jobs', ic: 'jobs' },
    { label: 'לקוחות פעילים', value: c?.companies, to: '/companies', ic: 'companies' },
    { label: 'השמות החודש', value: c?.placementsMonth, to: '/placements', ic: 'placements' },
  ];
  const PRI: Record<string,string> = { low:'נמוכה', normal:'רגילה', high:'גבוהה', urgent:'דחוף' };

  return (
    <div className="dash">
      <section className="hero">
        <div className="hero-ribbon" aria-hidden="true" />
        <div className="hero-in">
          <h1><span>אנשים</span> יוצרים הצלחה</h1>
          <p className="hero-subtitle">מחברים בין אנשים להזדמנויות אמיתיות</p>
          <p className="lede">גיוס והשמה חכמים, עם כל הכלים להוביל אותם קדימה</p>
          <div className="hero-cta">
            <Link to="/applications/new" className="btn btn-primary">+ פתיחת תהליך גיוס חדש</Link>
            <Link to="/candidates/new" className="hero-secondary">+ מועמד חדש</Link>
          </div>
        </div>
        <p className="hero-script" aria-hidden="true">Great<br/>People<br/>Great<br/>Companies</p>
        <p className="hero-words" aria-hidden="true">כישרונות<br/>מחברים<br/>עסקים<br/>לאנשים<br/>מוצלחים</p>
      </section>
      <div className="dashboard-workspace">
        {err && <p className="msg err">{err}</p>}
        <div className="tiles">
          {tiles.map(t => (
            <Link key={t.to} to={t.to} className="tile">
              <span className="tile-ic"><Icon name={t.ic} size={32} /></span>
              <div className="tile-copy"><span className="tile-val">{t.value ?? '—'}</span><span className="tile-lbl">{t.label}</span></div>
            </Link>
          ))}
        </div>
        <div className="dashboard-columns">
          <Panel title="משרות פתוחות" to="/jobs" className="jobs-panel" footer="כל המשרות הפתוחות">
            {jobs.length === 0 ? <Empty>אין משרות פתוחות</Empty> : jobs.map(j => (
              <Link key={j.id} to="/jobs" className="row job-row">
                <span className="company-mark" aria-hidden="true"><Icon name="jobs" /></span>
                <div className="row-copy"><div className="row-t">{j.title}</div><div className="row-s">{j.companies?.name ?? ''}{j.location ? ' · ' + j.location : ''}</div></div>
                <span className="tag">{j.applications?.length ?? 0} מועמדים</span>
                <span className={'tag ' + (j.stage === 'open' ? 'ok' : 'mute')}>{j.stage === 'open' ? 'פעילה' : 'בהמתנה'}</span>
              </Link>
            ))}
          </Panel>
          <Panel title="מועמדים אחרונים" to="/candidates" className="candidates-panel" footer="כל המועמדים">
            {cands.length === 0 ? <Empty>אין עדיין מועמדים</Empty> : cands.map(c => (
              <Link key={c.id} to={`/candidates/${c.id}`} className="row candidate-row">
                <span className="ava xs">{(c.full_name||'·').split(' ').filter(Boolean).slice(0,2).map((w: string) => w[0]).join('')}</span>
                <div className="row-copy"><div className="row-t">{c.full_name}</div><div className="row-s">{c.source ?? ''}</div></div>
                <span className="row-s row-date">{formatDate(c.created_at)}</span>
              </Link>
            ))}
          </Panel>
          <div className="activity-column">
            <Panel title="המשימות שלי" to="/tasks">
              {tasks.length === 0 ? <Empty>אין משימות פתוחות</Empty> : tasks.map(t => (
                <Link to="/tasks" key={t.id} className="row task-row">
                  <Icon name="tasks" size={19}/><div className="row-copy"><div className="row-t">{t.title}</div><div className="row-s">{formatDate(t.due_at)}</div></div>
                  <span className={'tag ' + (t.priority==='urgent'||t.priority==='high'?'warn':'mute')}>{PRI[t.priority]}</span>
                </Link>
              ))}
            </Panel>
            <Panel title="ראיונות קרובים" to="/applications">
              {schedule.length === 0 ? <Empty>אין ראיונות מתוזמנים</Empty> : schedule.map(s => (
                <div key={s.id} className="row schedule-row">
                  <span className="schedule-time">{new Date(s.scheduled_at).toLocaleTimeString('he-IL', { hour:'2-digit', minute:'2-digit' })}</span>
                  <Icon name="candidates" size={18}/><div className="row-copy"><div className="row-t">{s.applications?.candidates?.full_name ?? '—'} · {s.applications?.jobs?.title ?? ''}</div><div className="row-s">{formatDate(s.scheduled_at)}</div></div>
                </div>
              ))}
            </Panel>
          </div>
        </div>
      </div>
      <section className="team-banner" aria-label="הערכים שלנו">
        <svg className="banner-wave" viewBox="0 0 1300 65" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H1300V15C960 80 770 0 380 22S100 78 0 38Z" fill="#83d2df"/><path d="M0 0H1300V0C1030 46 740 0 370 13S90 58 0 15Z" fill="#eff9fc"/></svg>
        <h2>יחד בונים קריירות מצליחות<br/>וארגונים חזקים יותר</h2>
        <div className="banner-values"><div><Icon name="candidates" size={32}/><strong>אנשים</strong><span>בלב העשייה</span></div><div><Icon name="placements" size={32}/><strong>דיוק</strong><span>בכל שלב</span></div><div><Icon name="reports" size={32}/><strong>תוצאות</strong><span>שמובילות קדימה</span></div></div>
        <p className="banner-script">A Stronger<br/>Tomorrow</p>
      </section>
    </div>
  );
}

function Panel({ title, to, children, className = '', footer }: { title: string; to: string; children: ReactNode; className?: string; footer?: string }) {
  return <section className={'panel ' + className}><header><h2>{title}</h2><Link to={to} className="more">הצג הכל <Icon name="arrow" size={16}/></Link></header><div className="panel-body">{children}</div>{footer && <Link className="panel-footer" to={to}>{footer} <Icon name="arrow" size={16}/></Link>}</section>;
}
function Empty({ children }: { children: ReactNode }) { return <p className="p-empty">{children}</p>; }
