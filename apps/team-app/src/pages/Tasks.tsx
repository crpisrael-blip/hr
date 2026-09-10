import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

const PRI: Record<string,string> = { low:'נמוכה', normal:'רגילה', high:'גבוהה', urgent:'דחוף' };
const COLS: { key: string; label: string }[] = [
  { key: 'open', label: 'לביצוע' }, { key: 'in_progress', label: 'בעבודה' }, { key: 'done', label: 'הושלם' },
];

export default function Tasks() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState<'mine'|'all'>('mine');

  async function load() {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { data: emp } = await supabase.from('employees').select('id').eq('user_id', uid).maybeSingle();
    let q = supabase.from('tasks')
      .select('id, title, status, priority, due_at, task_assignees(employee_id)')
      .order('due_at', { ascending: true, nullsFirst: false }).limit(300);
    const r = await q;
    if (r.error) { setErr(r.error.message); return; }
    let data = r.data as any[];
    if (scope === 'mine' && emp) data = data.filter(t => (t.task_assignees ?? []).some((a: any) => a.employee_id === emp.id));
    setRows(data);
  }
  useEffect(() => { load(); }, [scope]);

  async function move(taskId: string, status: string) {
    const { error } = await supabase.from('tasks').update({ status, completed_at: status === 'done' ? new Date().toISOString() : null }).eq('id', taskId);
    if (error) setErr('עדכון המשימה נכשל: ' + error.message);
    load();
  }

  return (
    <>
      <PageHead title="משימות" sub="לוח המשימות של הצוות"
        action={<Link to="/tasks/new" className="btn btn-primary btn-sm">+ משימה חדשה</Link>} />
      <div className="seg">
        <button className={scope==='mine'?'on':''} onClick={()=>setScope('mine')}>שלי</button>
        <button className={scope==='all'?'on':''} onClick={()=>setScope('all')}>כל הצוות</button>
      </div>
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && (
        <div className="board">
          {COLS.map(col => {
            const items = rows.filter(t => t.status === col.key);
            return (
              <div className="board-col" key={col.key}>
                <div className="col-head">{col.label} <span className="col-n">{items.length}</span></div>
                <div className="col-body">
                  {items.length === 0 && <p className="hint" style={{ padding: 8 }}>—</p>}
                  {items.map(t => (
                    <div key={t.id} className="tcard">
                      <Link to={`/tasks/${t.id}`} className="tcard-t">{t.title}</Link>
                      <div className="tcard-meta">
                        <span className={'tag ' + (t.priority==='urgent'||t.priority==='high'?'warn':'mute')}>{PRI[t.priority]}</span>
                        {t.due_at && <span className="hint">{formatDate(t.due_at)}</span>}
                      </div>
                      <div className="tcard-move">
                        {col.key !== 'open' && <button onClick={()=>move(t.id, col.key==='done'?'in_progress':'open')} title="אחורה">▸</button>}
                        {col.key !== 'done' && <button onClick={()=>move(t.id, col.key==='open'?'in_progress':'done')} title="קדימה">◂</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--sunk); margin-bottom: 16px; }
        .seg button { border: 0; background: none; padding: 7px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; color: var(--ink-mid); }
        .seg button.on { background: var(--card-solid); color: var(--brand-ink); box-shadow: var(--shadow-sm); }
        .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; align-items: start; }
        .board-col { background: var(--card); border: 1px solid var(--card-brd); border-radius: 16px; backdrop-filter: blur(14px); box-shadow: var(--shadow-sm); overflow: hidden; }
        .col-head { padding: 12px 14px; font-weight: 700; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
        .col-n { font-size: .78rem; color: var(--ink-soft); background: var(--sunk); border-radius: 99px; padding: 1px 8px; }
        .col-body { padding: 8px; display: grid; gap: 8px; min-height: 60px; }
        .tcard { background: var(--card-solid); border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; display: grid; gap: 8px; }
        .tcard-t { font-weight: 600; font-size: .92rem; text-decoration: none; color: inherit; }
        .tcard-t:hover { color: var(--brand-ink); }
        .tcard-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tcard-move { display: flex; gap: 6px; justify-content: flex-end; }
        .tcard-move button { width: 28px; height: 26px; border-radius: 7px; border: 1px solid var(--line); background: var(--card); cursor: pointer; }
        @media (max-width: 820px) { .board { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
