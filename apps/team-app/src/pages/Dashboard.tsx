import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

const HERO_PHRASES = ['אנשים', 'הזדמנויות', 'צמיחה', 'מקומות', 'כישרון', 'הצלחה'];

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
          count(supabase.from('placements').select('*', { count: 'exact', head: true }).gte('created_at', monthStart.toISOString())),
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
    { label: 'מועמדים במאגר', value: c?.candidates, to: '/candidates', ic: '👥' },
    { label: 'משרות פתוחות', value: c?.jobsOpen, to: '/jobs', ic: '💼' },
    { label: 'לקוחות פעילים', value: c?.companies, to: '/companies', ic: '🏢' },
    { label: 'השמות החודש', value: c?.placementsMonth, to: '/placements', ic: '★' },
  ];
  const PRI: Record<string,string> = { low:'נמוכה', normal:'רגילה', high:'גבוהה', urgent:'דחוף' };

  return (
    <div className="dash">
      <section className="hero">
        <div className="hero-bg" aria-hidden="true">
          {HERO_PHRASES.map((p, i) => <span key={i} className={`hp hp${i}`}>{p}</span>)}
        </div>
        <div className="hero-in">
          <p className="eyebrow">People · Opportunities · Growth</p>
          <h1>מחברים בין אנשים להזדמנויות</h1>
          <p className="lede">גיוס והשמה שעושים את ההבדל. מכאן מנהלים את כל התהליך, מהמשרה ועד ההשמה.</p>
          <div className="hero-cta">
            <Link to="/applications/new" className="btn btn-primary">+ פתיחת תהליך גיוס חדש</Link>
            <Link to="/candidates/new" className="btn btn-ghost">+ מועמד חדש</Link>
          </div>
        </div>
      </section>

      {err && <p className="msg err">{err}</p>}
      <div className="tiles">
        {tiles.map(t => (
          <Link key={t.to} to={t.to} className="tile">
            <span className="tile-ic" aria-hidden="true">{t.ic}</span>
            <span className="tile-val">{t.value ?? '—'}</span>
            <span className="tile-lbl">{t.label}</span>
          </Link>
        ))}
      </div>

      <div className="cols">
        <Panel title="משרות פתוחות" to="/jobs">
          {jobs.length === 0 ? <Empty>אין משרות פתוחות</Empty> : jobs.map(j => (
            <Link key={j.id} to="/jobs" className="row">
              <div><div className="row-t">{j.title}</div><div className="row-s">{j.companies?.name ?? ''}{j.location ? ' · ' + j.location : ''}</div></div>
              <span className="tag">{j.applications?.length ?? 0} מועמדים</span>
            </Link>
          ))}
        </Panel>

        <Panel title="מועמדים אחרונים" to="/candidates">
          {cands.length === 0 ? <Empty>אין עדיין מועמדים</Empty> : cands.map(c => (
            <Link key={c.id} to={`/candidates/${c.id}`} className="row">
              <div className="row-av"><span className="ava xs">{(c.full_name||'·').slice(0,2)}</span>
                <div><div className="row-t">{c.full_name}</div><div className="row-s">{c.source ?? ''}</div></div></div>
              <span className="row-s">{formatDate(c.created_at)}</span>
            </Link>
          ))}
        </Panel>

        <Panel title="המשימות שלי" to="/tasks">
          {tasks.length === 0 ? <Empty>אין משימות פתוחות</Empty> : tasks.map(t => (
            <div key={t.id} className="row">
              <div className="row-t" style={{ fontWeight: 500 }}>{t.title}</div>
              <span className={'tag ' + (t.priority==='urgent'||t.priority==='high'?'warn':'mute')}>{PRI[t.priority]}</span>
            </div>
          ))}
        </Panel>
      </div>

      <Panel title="לוח זמנים קרוב" to="/applications" wide>
        {schedule.length === 0 ? <Empty>אין ראיונות מתוזמנים</Empty> : schedule.map(s => (
          <div key={s.id} className="row">
            <div className="row-t">🗓 {s.applications?.candidates?.full_name ?? '—'} · {s.applications?.jobs?.title ?? ''}</div>
            <span className="row-s">{new Date(s.scheduled_at).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</span>
          </div>
        ))}
      </Panel>

      <style>{dashCss}</style>
    </div>
  );
}

function Panel({ title, to, children, wide }: { title: string; to: string; children: ReactNodeLike; wide?: boolean }) {
  return (
    <section className={'panel' + (wide ? ' wide' : '')}>
      <header><h2>{title}</h2><Link to={to} className="more">הצג הכל ←</Link></header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
type ReactNodeLike = any;
function Empty({ children }: { children: ReactNodeLike }) { return <p className="p-empty">{children}</p>; }

const dashCss = `
.dash { display: grid; gap: 20px; }
.hero { position: relative; overflow: hidden; border-radius: 16px; padding: 40px 32px;
  background: linear-gradient(120deg, var(--brand) 0%, #17205e 55%, #24347e 100%); color: #fff; }
.hero-bg { position: absolute; inset: 0; pointer-events: none; opacity: .16; }
.hero-bg .hp { position: absolute; color: var(--accent); font-weight: 700; white-space: nowrap; }
.hero-bg .hp0 { top: 14%; inset-inline-start: 6%; font-size: 2.4rem; transform: rotate(-8deg); }
.hero-bg .hp1 { top: 60%; inset-inline-start: 12%; font-size: 3rem; transform: rotate(4deg); }
.hero-bg .hp2 { top: 30%; inset-inline-start: 42%; font-size: 2rem; transform: rotate(-3deg); }
.hero-bg .hp3 { top: 72%; inset-inline-start: 55%; font-size: 2.6rem; transform: rotate(6deg); }
.hero-bg .hp4 { top: 10%; inset-inline-start: 74%; font-size: 2.2rem; transform: rotate(-5deg); }
.hero-bg .hp5 { top: 52%; inset-inline-start: 82%; font-size: 2.8rem; transform: rotate(3deg); }
.hero-in { position: relative; max-width: 620px; }
.hero .eyebrow { color: var(--accent); font-weight: 600; letter-spacing: .12em; font-size: .78rem; text-transform: uppercase; }
.hero h1 { font-size: clamp(1.7rem, 1.2rem + 2vw, 2.5rem); margin: 8px 0 10px; text-wrap: balance; }
.hero .lede { color: #cdd8f5; font-size: 1.05rem; text-wrap: pretty; max-width: 46ch; }
.hero-cta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.btn-ghost { background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.3); }
.btn-ghost:hover { background: rgba(255,255,255,.2); }

.tiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.tile { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 18px 20px; display: grid; gap: 2px; text-decoration: none; color: inherit; box-shadow: var(--shadow-sm);
  transition-property: transform, border-color, box-shadow; transition-duration: 140ms; transition-timing-function: ease-out; }
.tile:hover { transform: translateY(-2px); border-color: var(--line-strong); box-shadow: var(--shadow-md); }
.tile-ic { position: absolute; inset-inline-end: 16px; top: 16px; width: 40px; height: 40px; border-radius: 11px;
  display: grid; place-items: center; background: var(--brand-soft); font-size: 1.1rem; }
.tile-val { font-size: 2.1rem; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.1; }
.tile-lbl { color: var(--ink-mid); font-size: .9rem; }

.cols { display: grid; gap: 16px; grid-template-columns: repeat(3, 1fr); }
.panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow-sm); overflow: hidden; }
.panel > header { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 10px; }
.panel h2 { font-size: 1.02rem; }
.more { font-size: .84rem; font-weight: 600; white-space: nowrap; text-decoration: none; }
.panel-body { padding: 4px 8px 10px; display: grid; gap: 2px; }
.row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border-radius: 8px;
  text-decoration: none; color: inherit; transition-property: background-color; transition-duration: 120ms; }
a.row:hover { background: var(--sunk); }
.row-t { font-weight: 600; font-size: .92rem; }
.row-s { color: var(--ink-soft); font-size: .8rem; }
.row-av { display: flex; align-items: center; gap: 10px; }
.ava.xs { width: 32px; height: 32px; font-size: .72rem; }
.p-empty { color: var(--ink-soft); font-size: .9rem; padding: 16px 10px; }
.panel.wide .panel-body { grid-template-columns: 1fr; }
@media (max-width: 1000px) { .cols { grid-template-columns: 1fr; } }
`;
