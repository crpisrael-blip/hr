import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

interface Row { id: string; title: string; status: string; priority: string; due_at: string | null; }
const PRIORITY: Record<string,string> = { low:'נמוכה', normal:'רגילה', high:'גבוהה', urgent:'דחופה' };
const STATUS: Record<string,string> = { open:'פתוחה', in_progress:'בעבודה', done:'הושלמה', cancelled:'בוטלה' };

export default function Tasks() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('tasks').select('id, title, status, priority, due_at')
      .in('status', ['open', 'in_progress']).order('due_at', { ascending: true, nullsFirst: false }).limit(200)
      .then(r => { if (r.error) setErr(r.error.message); else setRows(r.data as Row[]); });
  }, []);
  return (
    <>
      <PageHead title="משימות" sub="משימות פתוחות" />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין משימות פתוחות.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead><tr><th>משימה</th><th>עדיפות</th><th>מצב</th><th>יעד</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td style={{ fontWeight: 600 }}>{r.title}</td>
                <td><span className={'tag ' + (r.priority==='urgent'||r.priority==='high'?'warn':'mute')}>{PRIORITY[r.priority]}</span></td>
                <td>{STATUS[r.status]}</td><td className="num">{formatDate(r.due_at)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
