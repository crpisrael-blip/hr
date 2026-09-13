import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate, label, TASK_PRIORITY } from '../lib/format';
import { rpcErrorMessage, toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import { Msg, Loading } from '../components/Msg';

interface TaskRow { id: string; title: string; status: string; priority: string; due_at: string | null; privacy: string; created_by: string | null }

const COLS: { key: string; label: string }[] = [
  { key: 'open', label: 'לביצוע' }, { key: 'in_progress', label: 'בעבודה' }, { key: 'done', label: 'הושלם' },
];

export default function Tasks() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const [rows, setRows] = useState<TaskRow[] | null>(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [moving, setMoving] = useState('');
  const [more, setMore] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);

  const load = useCallback(async () => {
    if (!empId) return;
    setErr('');
    // סינון "שלי" בשרת: סינון בלקוח אחרי limit הסתיר משימות שלי בצוות עמוס.
    let q = supabase.from('tasks')
      .select(scope === 'mine'
        ? 'id, title, status, priority, due_at, privacy, created_by, task_assignees!inner(employee_id)'
        : 'id, title, status, priority, due_at, privacy, created_by')
      .neq('status', 'cancelled')
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(limit);
    if (scope === 'mine') q = q.eq('task_assignees.employee_id', empId);
    // משימה פרטית נראית רק ליוצר ולמשויכים אליה.
    else q = q.eq('privacy', 'normal');
    const r = await q;
    if (r.error) { setErr(toUserMessage(r.error, 'טעינת המשימות נכשלה.')); setRows([]); return; }
    const data = r.data as unknown as TaskRow[];
    setMore(data.length >= limit);
    setRows(data);
  }, [scope, empId, limit]);

  useEffect(() => { setRows(null); load(); }, [load]);

  async function move(taskId: string, status: string) {
    setMoving(taskId); setErr('');
    // RPC אחד ששומר על עקביות בין tasks.status לבין task_assignees.personal_status.
    const { error } = await supabase.rpc('set_task_status', { p_task_id: taskId, p_status: status });
    setMoving('');
    if (error) { setErr(rpcErrorMessage(error, 'עדכון מצב המשימה')); return; }
    load();
  }

  return (
    <>
      <PageHead title="משימות" sub="לוח המשימות של הצוות"
        action={<Link to="/tasks/new" className="btn btn-primary btn-sm">+ משימה חדשה</Link>} />
      <div className="seg" role="group" aria-label="היקף המשימות">
        <button type="button" className={scope === 'mine' ? 'on' : ''} aria-pressed={scope === 'mine'}
          onClick={() => { setLimit(PAGE_SIZE); setScope('mine'); }}>שלי</button>
        <button type="button" className={scope === 'all' ? 'on' : ''} aria-pressed={scope === 'all'}
          onClick={() => { setLimit(PAGE_SIZE); setScope('all'); }}>כל הצוות</button>
      </div>
      <Msg kind="err">{err}</Msg>
      {!rows && !err && <Loading />}
      {rows && (
        <div className="board">
          {COLS.map(col => {
            const items = rows.filter(t => t.status === col.key);
            return (
              <section className="board-col" key={col.key} aria-label={col.label}>
                <div className="col-head">{col.label} <span className="col-n">{items.length}</span></div>
                <div className="col-body">
                  {items.length === 0 && <p className="hint" style={{ padding: 8 }}>אין משימות בעמודה זו</p>}
                  {items.map(t => (
                    <div key={t.id} className="tcard">
                      <Link to={`/tasks/${t.id}`} className="tcard-t">{t.title}</Link>
                      <div className="tcard-meta">
                        <span className={'tag ' + (t.priority === 'urgent' || t.priority === 'high' ? 'warn' : 'mute')}>{label(TASK_PRIORITY, t.priority)}</span>
                        {t.due_at && <span className="hint">{formatDate(t.due_at)}</span>}
                      </div>
                      <div className="tcard-move">
                        {col.key !== 'open' && (
                          <button disabled={moving === t.id} onClick={() => move(t.id, col.key === 'done' ? 'in_progress' : 'open')}
                            aria-label={`החזרת "${t.title}" לשלב הקודם`}>▸</button>
                        )}
                        {col.key !== 'done' && (
                          <button disabled={moving === t.id} onClick={() => move(t.id, col.key === 'open' ? 'in_progress' : 'done')}
                            aria-label={`קידום "${t.title}" לשלב הבא`}>◂</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד משימות</button>
        </div>
      )}
      <style>{`
        .seg { display: inline-flex; gap: 2px; padding: 3px; border-radius: 10px; background: var(--sunk); margin-bottom: 16px; }
        .seg button { border: 0; background: none; padding: 7px 16px; border-radius: 8px; cursor: pointer; font-weight: 600; color: var(--ink-mid); }
        .seg button.on { background: var(--card-solid); color: var(--brand-ink); box-shadow: var(--shadow-sm); }
        .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; align-items: start; }
        .board-col { background: var(--card); border: 1px solid var(--card-brd); border-radius: 16px; box-shadow: var(--shadow-sm); overflow: hidden; }
        .col-head { padding: 12px 14px; font-weight: 700; border-bottom: 1px solid var(--line); display: flex; gap: 8px; align-items: center; }
        .col-n { font-size: .78rem; color: var(--ink-soft); background: var(--sunk); border-radius: 99px; padding: 1px 8px; }
        .col-body { padding: 8px; display: grid; gap: 8px; min-height: 60px; }
        .tcard { background: var(--card-solid); border: 1px solid var(--line); border-radius: 11px; padding: 11px 12px; display: grid; gap: 8px; }
        .tcard-t { font-weight: 600; font-size: .92rem; text-decoration: none; color: inherit; }
        .tcard-t:hover { color: var(--brand-ink); }
        .tcard-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .tcard-move { display: flex; gap: 6px; justify-content: flex-end; }
        .tcard-move button { min-width: 32px; min-height: 32px; border-radius: 7px; border: 1px solid var(--line); background: var(--card); cursor: pointer; }
        @media (max-width: 820px) { .board { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
