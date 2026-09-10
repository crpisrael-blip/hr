import { useEffect, useState } from 'react';
import { supabase, fin as financeDb } from '../lib/supabase';
import { APP_STAGE, money } from '../lib/format';
import PageHead from '../components/PageHead';

export default function Reports() {
  const [stages, setStages] = useState<Record<string, number>>({});
  const [fin, setFin] = useState<{ placements: number; commission: number } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const apps = await supabase.from('applications').select('stage');
      if (apps.error) { setErr(apps.error.message); return; }
      const counts: Record<string, number> = {};
      (apps.data as any[]).forEach(a => { counts[a.stage] = (counts[a.stage] ?? 0) + 1; });
      setStages(counts);
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const pl = await financeDb.from('placements').select('expected_commission, created_at').gte('created_at', monthStart.toISOString());
      if (!pl.error) {
        const rows = pl.data as any[];
        setFin({ placements: rows.length, commission: rows.reduce((s, r) => s + Number(r.expected_commission || 0), 0) });
      }
    })();
  }, []);

  const workStages = ['new','screening','initial_call','submitted_to_client','interview','offer','hired'];
  const maxN = Math.max(1, ...workStages.map(s => stages[s] ?? 0));

  return (
    <>
      <PageHead title="דוחות" sub="תמונת תפעול" />
      {err && <p className="msg err">{err}</p>}
      <div className="cards2">
        <section className="card" style={{ padding: 22 }}>
          <h2 className="sec">מועמדויות לפי שלב</h2>
          <div className="funnel">
            {workStages.map(s => (
              <div key={s} className="fn-row">
                <span className="fn-lbl">{APP_STAGE[s]}</span>
                <div className="fn-bar"><div style={{ width: `${((stages[s] ?? 0) / maxN) * 100}%` }} /></div>
                <span className="fn-n num">{stages[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card" style={{ padding: 22 }}>
          <h2 className="sec">השמות החודש</h2>
          {!fin ? <p className="hint">טוען…</p> : (
            <div className="kpis">
              <div><span className="k-v num">{fin.placements}</span><span className="k-l">השמות</span></div>
              <div><span className="k-v num">{money(fin.commission)}</span><span className="k-l">עמלה צפויה מצטברת</span></div>
            </div>
          )}
          <p className="hint" style={{ marginTop: 14 }}>דוחות מפורטים יותר (לפי מגייס, לפי לקוח, לאורך זמן) יתווספו כשיצטברו נתונים.</p>
        </section>
      </div>
      <style>{`
        .cards2 { display: grid; gap: 16px; grid-template-columns: 1.3fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 16px; }
        .funnel { display: grid; gap: 10px; }
        .fn-row { display: grid; grid-template-columns: 110px 1fr 40px; align-items: center; gap: 10px; }
        .fn-lbl { font-size: .86rem; color: var(--ink-mid); }
        .fn-bar { height: 22px; background: var(--sunk); border-radius: 7px; overflow: hidden; }
        .fn-bar div { height: 100%; background: linear-gradient(90deg, var(--brand), var(--accent)); border-radius: 7px; min-width: 2px; transition: width .3s; }
        .fn-n { text-align: start; font-weight: 600; }
        .kpis { display: grid; gap: 16px; }
        .k-v { font-family: var(--disp); font-size: 1.9rem; font-weight: 700; display: block; }
        .k-l { color: var(--ink-mid); font-size: .9rem; }
        @media (max-width: 820px) { .cards2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
