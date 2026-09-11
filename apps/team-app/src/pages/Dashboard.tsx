import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase, fin } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate, initials, label, TASK_PRIORITY } from '../lib/format';
import { monthStartIso } from '../lib/dates';
import { toUserMessage } from '../lib/errors';
import Icon from '../components/Icon';
import { Msg } from '../components/Msg';

interface Counts { candidates: number; jobsOpen: number; companies: number; placementsMonth: number }
interface JobRow { id: string; title: string; location: string | null; stage: string; companies: { name: string } | null; applications: { id: string }[] | null }
interface CandRow { id: string; full_name: string; source: string | null; created_at: string }
interface TaskRow { id: string; title: string; priority: string; due_at: string | null }
interface SchedRow { id: string; scheduled_at: string; applications: { candidates: { full_name: string } | null; jobs: { title: string } | null } | null }

const PANEL_LIMIT = 5;

export default function Dashboard() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const [c, setC] = useState<Counts | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [cands, setCands] = useState<CandRow[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [schedule, setSchedule] = useState<SchedRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const count = (q: PromiseLike<{ count: number | null; error: unknown }>) =>
          Promise.resolve(q).then(r => { if (r.error) throw r.error; return r.count ?? 0; });
        const [candidates, jobsOpen, companies, placementsMonth] = await Promise.all([
          count(supabase.from('candidates').select('*', { count: 'exact', head: true })),
          count(supabase.from('jobs').select('*', { count: 'exact', head: true }).eq('stage', 'open')),
          count(supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'active')),
          count(fin.from('placements').select('*', { count: 'exact', head: true }).gte('created_at', monthStartIso())),
        ]);
        if (alive) setC({ candidates, jobsOpen, companies, placementsMonth });
      } catch (e) { if (alive) setErr(toUserMessage(e, 'טעינת הנתונים נכשלה.')); }
    })();

    const fail = (what: string) => (e: unknown) => { console.error('[hr] dashboard ' + what, e); if (alive) setErr(toUserMessage(e, 'חלק מהנתונים לא נטענו.')); };

    supabase.from('jobs').select('id, title, location, stage, companies(name), applications(id)')
      .in('stage', ['open', 'on_hold']).order('created_at', { ascending: false }).limit(PANEL_LIMIT)
      .then(r => { if (!alive) return; if (r.error) fail('jobs')(r.error); else setJobs(r.data as unknown as JobRow[]); });

    supabase.from('candidates').select('id, full_name, source, created_at')
      .order('created_at', { ascending: false }).limit(PANEL_LIMIT)
      .then(r => { if (!alive) return; if (r.error) fail('candidates')(r.error); else setCands(r.data as CandRow[]); });

    // "המשימות שלי" — סינון בשרת לפי שיוך, לא כל המשימות הפתוחות של הצוות.
    if (empId) {
      supabase.from('tasks')
        .select('id, title, priority, due_at, task_assignees!inner(employee_id)')
        .eq('task_assignees.employee_id', empId)
        .in('status', ['open', 'in_progress'])
        .order('due_at', { ascending: true, nullsFirst: false }).limit(PANEL_LIMIT)
        .then(r => { if (!alive) return; if (r.error) fail('tasks')(r.error); else setTasks(r.data as unknown as TaskRow[]); });
    } else setTasks([]);

    supabase.from('interviews').select('id, scheduled_at, applications(candidates(full_name), jobs(title))')
      .gte('scheduled_at', new Date().toISOString()).neq('status', 'cancelled').order('scheduled_at').limit(PANEL_LIMIT)
      .then(r => { if (!alive) return; if (r.error) fail('interviews')(r.error); else setSchedule(r.data as unknown as SchedRow[]); });

    return () => { alive = false; };
  }, [empId]);

  const tiles = [
    { label: 'מועמדים במאגר', value: c?.candidates, to: '/candidates', ic: 'candidates' },
    { label: 'משרות פתוחות', value: c?.jobsOpen, to: '/jobs', ic: 'jobs' },
    { label: 'לקוחות פעילים', value: c?.companies, to: '/companies', ic: 'companies' },
    { label: 'השמות החודש', value: c?.placementsMonth, to: '/placements', ic: 'placements' },
  ];

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
        <Msg kind="err">{err}</Msg>
        <div className="tiles">
          {tiles.map(t => (
            <Link key={t.to} to={t.to} className="tile">
              <span className="tile-ic" aria-hidden="true"><Icon name={t.ic} size={32} /></span>
              <div className="tile-copy">
                <span className="tile-val">{t.value ?? '—'}</span>
                <span className="tile-lbl">{t.label}</span>
              </div>
            </Link>
          ))}
        </div>
        <div className="dashboard-columns">
          <Panel title="משרות פתוחות" to="/jobs" className="jobs-panel" footer="כל המשרות הפתוחות">
            <PanelBody rows={jobs} empty="אין משרות פתוחות">
              {(j: JobRow) => (
                <Link key={j.id} to={`/jobs/${j.id}`} className="row job-row">
                  <span className="company-mark" aria-hidden="true"><Icon name="jobs" /></span>
                  <div className="row-copy"><div className="row-t">{j.title}</div><div className="row-s">{j.companies?.name ?? ''}{j.location ? ' · ' + j.location : ''}</div></div>
                  <span className="tag">{j.applications?.length ?? 0} מועמדים</span>
                  <span className={'tag ' + (j.stage === 'open' ? 'ok' : 'mute')}>{j.stage === 'open' ? 'פעילה' : 'בהמתנה'}</span>
                </Link>
              )}
            </PanelBody>
          </Panel>
          <Panel title="מועמדים אחרונים" to="/candidates" className="candidates-panel" footer="כל המועמדים">
            <PanelBody rows={cands} empty="אין עדיין מועמדים">
              {(c2: CandRow) => (
                <Link key={c2.id} to={`/candidates/${c2.id}`} className="row candidate-row">
                  <span className="ava xs" aria-hidden="true">{initials(c2.full_name)}</span>
                  <div className="row-copy"><div className="row-t">{c2.full_name}</div><div className="row-s">{c2.source ?? ''}</div></div>
                  <span className="row-s row-date">{formatDate(c2.created_at)}</span>
                </Link>
              )}
            </PanelBody>
          </Panel>
          <div className="activity-column">
            <Panel title="המשימות שלי" to="/tasks">
              <PanelBody rows={tasks} empty="אין לכם משימות פתוחות">
                {(t: TaskRow) => (
                  <Link to={`/tasks/${t.id}`} key={t.id} className="row task-row">
                    <Icon name="tasks" size={19}/>
                    <div className="row-copy"><div className="row-t">{t.title}</div><div className="row-s">{t.due_at ? formatDate(t.due_at) : 'ללא תאריך יעד'}</div></div>
                    <span className={'tag ' + (t.priority === 'urgent' || t.priority === 'high' ? 'warn' : 'mute')}>{label(TASK_PRIORITY, t.priority)}</span>
                  </Link>
                )}
              </PanelBody>
            </Panel>
            <Panel title="ראיונות קרובים" to="/applications">
              <PanelBody rows={schedule} empty="אין ראיונות מתוזמנים">
                {(s: SchedRow) => (
                  <div key={s.id} className="row schedule-row">
                    <span className="schedule-time">{new Date(s.scheduled_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}</span>
                    <Icon name="candidates" size={18}/>
                    <div className="row-copy"><div className="row-t">{s.applications?.candidates?.full_name ?? '—'} · {s.applications?.jobs?.title ?? ''}</div><div className="row-s">{formatDate(s.scheduled_at)}</div></div>
                  </div>
                )}
              </PanelBody>
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

/** מצבי טעינה/ריק אחידים לפאנלים בדף הבית. */
function PanelBody<T>({ rows, empty, children }: { rows: T[] | null; empty: string; children: (row: T) => ReactNode }) {
  if (rows === null) return <p className="p-empty" role="status" aria-live="polite" aria-busy="true">טוען…</p>;
  if (!rows.length) return <p className="p-empty">{empty}</p>;
  return <>{rows.map(children)}</>;
}

function Panel({ title, to, children, className = '', footer }:
  { title: string; to: string; children: ReactNode; className?: string; footer?: string }) {
  return (
    <section className={'panel ' + className}>
      <header><h2>{title}</h2><Link to={to} className="more">הצג הכל <Icon name="arrow" size={16}/></Link></header>
      <div className="panel-body">{children}</div>
      {footer && <Link className="panel-footer" to={to}>{footer} <Icon name="arrow" size={16}/></Link>}
    </section>
  );
}
