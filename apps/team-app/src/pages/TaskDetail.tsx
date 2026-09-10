import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

const PRI: Record<string,string> = { low:'נמוכה', normal:'רגילה', high:'גבוהה', urgent:'דחוף' };
const AST: Record<string,string> = { pending:'ממתין', in_progress:'בעבודה', done:'בוצע', removed:'הוסר' };

export default function TaskDetail() {
  const { id } = useParams(); const nav = useNavigate();
  const [t, setT] = useState<any>(null); const [asg, setAsg] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [meId, setMeId] = useState<string|null>(null);

  async function load() {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const { data: emp } = await supabase.from('employees').select('id').eq('user_id', uid).maybeSingle();
    setMeId(emp?.id ?? null);
    const r = await supabase.from('tasks').select('*').eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('המשימה לא נמצאה'); return; }
    setT(r.data);
    const a = await supabase.from('task_assignees').select('*, employees(full_name)').eq('task_id', id);
    if (!a.error) setAsg(a.data);
  }
  useEffect(() => { load(); }, [id]);

  async function markMine(status: string) {
    if (!meId) return;
    await supabase.from('task_assignees').update({ personal_status: status, done_at: status==='done'?new Date().toISOString():null })
      .eq('task_id', id).eq('employee_id', meId);
    // עדכון סטטוס המשימה לפי כלל ההשלמה
    const { data: rows } = await supabase.from('task_assignees').select('personal_status').eq('task_id', id);
    const active = (rows ?? []).filter((r:any)=>r.personal_status!=='removed');
    const done = active.filter((r:any)=>r.personal_status==='done');
    const rule = t.completion_rule;
    let newStatus = t.status;
    if (rule === 'any_assignee' && done.length >= 1) newStatus = 'done';
    else if (rule === 'all_assignees' && active.length > 0 && done.length === active.length) newStatus = 'done';
    else if (done.length > 0) newStatus = 'in_progress';
    if (newStatus !== t.status) await supabase.from('tasks').update({ status: newStatus, completed_at: newStatus==='done'?new Date().toISOString():null }).eq('id', id);
    load();
  }
  async function cancel() {
    const reason = prompt('סיבת ביטול:'); if (!reason) return;
    await supabase.from('tasks').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id); nav('/tasks');
  }

  if (err) return <p className="msg err">{err}</p>;
  if (!t) return <p className="spinner">טוען…</p>;
  const mine = asg.find(a => a.employee_id === meId);

  return (
    <>
      <PageHead title={t.title} sub={t.source === 'manual' ? 'משימה ידנית' : 'משימה אוטומטית'}
        action={<button className="btn btn-quiet btn-sm" onClick={cancel}>ביטול משימה</button>} />
      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">פרטים</h2>
          {t.description && <p style={{ marginBottom: 12 }}>{t.description}</p>}
          <dl className="dl">
            <dt>עדיפות</dt><dd><span className={'tag '+(t.priority==='urgent'||t.priority==='high'?'warn':'mute')}>{PRI[t.priority]}</span></dd>
            <dt>מצב</dt><dd>{({open:'לביצוע',in_progress:'בעבודה',done:'הושלמה',cancelled:'בוטלה'} as any)[t.status]}</dd>
            <dt>יעד</dt><dd>{t.due_at ? formatDate(t.due_at) : '—'}</dd>
            <dt>כלל השלמה</dt><dd>{t.completion_rule==='any_assignee'?'אחראי אחד מספיק':'כל האחראים'}</dd>
          </dl>
          {mine && mine.personal_status !== 'done' && t.status !== 'cancelled' &&
            <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} onClick={()=>markMine('done')}>סימון "בוצע" עבורי</button>}
          {mine && mine.personal_status === 'done' && <p className="msg ok" style={{ marginTop: 16 }}>סימנת שביצעת ✓</p>}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">אחראים ({asg.length})</h2>
          {asg.map(a => (
            <div key={a.employee_id} className="subrow">
              <span>{a.employees?.full_name}{a.employee_id===meId && ' (אני)'}</span>
              <span className={'tag ' + (a.personal_status==='done'?'ok':'mute')}>{AST[a.personal_status]}</span>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 12px; }
        .dl { display: grid; grid-template-columns: 110px 1fr; gap: 8px 12px; margin: 0; }
        .dl dt { color: var(--ink-soft); font-size: .88rem; } .dl dd { margin: 0; }
        .subrow { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .subrow:last-child { border-bottom: 0; }
        @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
