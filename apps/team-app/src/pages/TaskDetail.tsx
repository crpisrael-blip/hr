import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate, label, ASSIGNEE_STATUS, TASK_PRIORITY, TASK_STATUS, TASK_COMPLETION } from '../lib/format';
import { useLoad, unwrap } from '../lib/useLoad';
import { rpcErrorMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg, Loading } from '../components/Msg';

interface Task {
  id: string; title: string; description: string | null; priority: string; status: string;
  due_at: string | null; completion_rule: string; source: string; cancel_reason: string | null;
}
interface Assignee {
  employee_id: string; personal_status: string; done_at: string | null;
  employees: { full_name: string } | null;
}

export default function TaskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { employee } = useAuth();
  const meId = employee?.id ?? null;
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const { data, err: loadErr, loading, reload } = useLoad(async () => {
    const task = unwrap(await supabase.from('tasks').select('*').eq('id', id).maybeSingle()) as Task | null;
    if (!task) throw { code: 'PGRST116', message: 'task not found' };
    // ★ task_assignees מחזיקה שני מפתחות זרים ל-employees (employee_id, added_by);
    // ללא ציון המפתח PostgREST מחזיר PGRST201 והרשימה נשארת ריקה לעד.
    const asg = unwrap(await supabase.from('task_assignees')
      .select('employee_id, personal_status, done_at, employees!employee_id(full_name)')
      .eq('task_id', id)) as unknown as Assignee[];
    return { task, asg };
  }, [id]);

  async function markMineDone() {
    if (!meId) return;
    setErr(''); setBusy(true);
    // RPC יחיד: מעדכן את הסטטוס האישי ומחשב מחדש את מצב המשימה לפי כלל ההשלמה.
    const { error } = await supabase.rpc('set_my_task_status', { p_task_id: id, p_status: 'done' });
    setBusy(false);
    if (error) { setErr(rpcErrorMessage(error, 'סימון המשימה כבוצעה')); return; }
    reload();
  }

  async function cancelTask() {
    const reason = cancelReason.trim();
    if (!reason) { setErr('נא לציין סיבת ביטול.'); return; }
    setBusy(true); setErr('');
    const { error } = await supabase.from('tasks').update({ status: 'cancelled', cancel_reason: reason }).eq('id', id);
    setBusy(false);
    if (error) { setErr(rpcErrorMessage(error, 'ביטול המשימה')); return; }
    setCancelOpen(false);
    nav('/tasks');
  }

  if (loading) return <Loading />;
  if (loadErr || !data) return <Msg kind="err">{loadErr || 'המשימה לא נמצאה.'}</Msg>;

  const { task: t, asg } = data;
  const mine = asg.find(a => a.employee_id === meId);

  return (
    <>
      <PageHead title={t.title} sub={t.source === 'manual' ? 'משימה ידנית' : 'משימה אוטומטית'}
        action={t.status !== 'cancelled'
          ? <button className="btn btn-quiet btn-sm" onClick={() => { setCancelReason(''); setCancelOpen(true); }}>ביטול משימה</button>
          : undefined} />
      <Msg kind="err">{err}</Msg>
      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">פרטים</h2>
          {t.description && <p style={{ marginBottom: 12 }}>{t.description}</p>}
          <dl className="dl">
            <dt>עדיפות</dt><dd><span className={'tag ' + (t.priority === 'urgent' || t.priority === 'high' ? 'warn' : 'mute')}>{label(TASK_PRIORITY, t.priority)}</span></dd>
            <dt>מצב</dt><dd>{label(TASK_STATUS, t.status)}</dd>
            <dt>יעד</dt><dd>{t.due_at ? formatDate(t.due_at) : '—'}</dd>
            <dt>כלל השלמה</dt><dd>{label(TASK_COMPLETION, t.completion_rule)}</dd>
            {t.cancel_reason && <><dt>סיבת ביטול</dt><dd>{t.cancel_reason}</dd></>}
          </dl>
          {mine && mine.personal_status !== 'done' && t.status !== 'cancelled' &&
            <button className="btn btn-primary btn-sm" style={{ marginTop: 16 }} disabled={busy}
              onClick={markMineDone}>{busy ? 'מעדכן…' : 'סימון "בוצע" עבורי'}</button>}
          {mine && mine.personal_status === 'done' && <Msg kind="ok" style={{ marginTop: 16 }}>סימנת שביצעת ✓</Msg>}
          {!mine && <p className="hint" style={{ marginTop: 16 }}>אינכם משויכים למשימה זו.</p>}
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">אחראים ({asg.length})</h2>
          {asg.length === 0 ? <p className="hint">אין אחראים למשימה זו.</p> : asg.map(a => (
            <div key={a.employee_id} className="subrow">
              <span>{a.employees?.full_name ?? '—'}{a.employee_id === meId && ' (אני)'}</span>
              <span className={'tag ' + (a.personal_status === 'done' ? 'ok' : 'mute')}>{label(ASSIGNEE_STATUS, a.personal_status)}</span>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={cancelOpen} title="ביטול משימה" onClose={() => setCancelOpen(false)} onSubmit={cancelTask}
        description="הביטול נשמר עם הסיבה ומופיע בכרטיס המשימה."
        footer={<>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'מבטל…' : 'ביטול המשימה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => setCancelOpen(false)}>חזרה</button>
        </>}>
        <label><span className="lbl">סיבת הביטול *</span>
          <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={3} required /></label>
        <Msg kind="err">{err}</Msg>
      </Dialog>

      <style>{`
        .subrow { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .subrow:last-child { border-bottom: 0; }
      `}</style>
    </>
  );
}
