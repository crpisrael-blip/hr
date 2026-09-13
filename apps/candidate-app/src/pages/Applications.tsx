import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDate, isoAttr } from '../lib/shared';
import { reportError } from '../lib/errors';
import { useTitle } from '../lib/useTitle';

interface AppRow {
  id: string; job_title: string; exposed: boolean;
  status_label: string; status_explanation: string | null;
  is_closed: boolean; applied_at: string; updated_at: string;
}

export default function Applications() {
  useTitle('המועמדויות שלי');
  const [rows, setRows] = useState<AppRow[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc('my_applications');
    setBusy(false);
    if (error) {
      setErr(reportError('my_applications', error, 'טעינת המועמדויות נכשלה.'));
      setRows(prev => prev ?? []);
      return;
    }
    setErr('');
    setRows((data ?? []) as AppRow[]);
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (rows === null) return <div className="screen-center"><div className="spinner" role="status" aria-label="טוען" /></div>;

  return (
    <section className="page">
      <h1 className="page-title">המועמדויות שלי</h1>

      {err && (
        <div className="msg err" role="alert">
          <span>{err}</span>{' '}
          <button type="button" className="linkish" disabled={busy} onClick={() => void load()}>
            {busy ? 'טוען…' : 'נסו שוב'}
          </button>
        </div>
      )}

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
              <p className="app-date">
                הוגש ב־<time dateTime={isoAttr(a.applied_at)}>{fmtDate(a.applied_at)}</time>
              </p>
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
