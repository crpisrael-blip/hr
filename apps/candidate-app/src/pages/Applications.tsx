import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDate } from '../lib/format';

interface AppRow {
  id: string; job_title: string; exposed: boolean;
  status_label: string; status_explanation: string | null;
  is_closed: boolean; applied_at: string; updated_at: string;
}

export default function Applications() {
  const [rows, setRows] = useState<AppRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('my_applications').then(({ data, error }) => {
      if (error) { setErr('טעינת המועמדויות נכשלה.'); setRows([]); }
      else setRows((data ?? []) as AppRow[]);
    });
  }, []);

  if (rows === null) return <div className="screen-center"><div className="spinner" /></div>;

  return (
    <section className="page">
      <h1 className="page-title">המועמדויות שלי</h1>
      {err && <p className="msg err">{err}</p>}
      {rows.length === 0 && !err && (
        <div className="card empty">
          <p>עדיין אין מועמדויות פעילות.</p>
          <p className="sub">כשתגיש/י מועמדות למשרה, היא תופיע כאן עם עדכוני הסטטוס.</p>
        </div>
      )}
      <div className="stack">
        {rows.map(a => (
          <Link key={a.id} to={`/applications/${a.id}`} className={'card app-card' + (a.is_closed ? ' closed' : '')}>
            <div className="app-main">
              <h2>{a.job_title}</h2>
              <p className="app-date">הוגש ב־{fmtDate(a.applied_at)}</p>
            </div>
            <span className={'chip' + (a.is_closed ? ' chip-mute' : a.exposed ? ' chip-live' : ' chip-soft')}>
              {a.status_label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
