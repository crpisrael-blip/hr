import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { isTaskLinkEntity } from '../lib/entities';
import { TASK_PRIORITY, TASK_COMPLETION } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg } from '../components/Msg';

interface EmployeeOption { id: string; full_name: string }

export default function TaskNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { employee } = useAuth();
  const meId = employee?.id ?? null;
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [f, setF] = useState({ title: '', description: '', priority: 'normal', due_at: '', completion_rule: 'all_assignees' });
  const [assignees, setAssignees] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => {
    let alive = true;
    supabase.from('employees').select('id, full_name').eq('employment_status', 'active').order('full_name')
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת העובדים נכשלה.')); return; }
        setEmployees(r.data as EmployeeOption[]);
      });
    return () => { alive = false; };
  }, []);

  // ברירת מחדל: המשימה משויכת ליוצר. useAuth כבר מחזיק את מזהה העובד.
  useEffect(() => { if (meId) setAssignees(a => (a.length ? a : [meId])); }, [meId]);

  function toggle(id: string) { setAssignees(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { data, error } = await supabase.from('tasks').insert({
      title: f.title.trim(), description: f.description.trim() || null, priority: f.priority,
      due_at: f.due_at ? new Date(f.due_at).toISOString() : null, completion_rule: f.completion_rule,
      source: 'manual', created_by: meId,
    }).select('id').single();
    if (error || !data) { setErr(toUserMessage(error, 'יצירת המשימה נכשלה.')); setBusy(false); return; }

    const list = assignees.length ? assignees : (meId ? [meId] : []);
    if (list.length) {
      const ins = await supabase.from('task_assignees')
        .insert(list.map(eid => ({ task_id: data.id, employee_id: eid, added_by: meId })));
      if (ins.error) {
        // המשימה נוצרה אך ללא אחראים — לא מנווטים כאילו הכול הצליח.
        setBusy(false);
        setErr(toUserMessage(ins.error, 'המשימה נוצרה אך שיוך האחראים נכשל. פתחו את המשימה והוסיפו אחראים.'));
        return;
      }
    }

    const linkType = sp.get('type'); const linkId = sp.get('id');
    if (linkId && isTaskLinkEntity(linkType)) {
      const lnk = await supabase.from('task_links').insert({ task_id: data.id, entity_type: linkType, entity_id: linkId });
      if (lnk.error) { setBusy(false); setErr(toUserMessage(lnk.error, 'המשימה נוצרה אך הקישור לישות נכשל.')); return; }
    } else if (linkType) {
      console.error('[hr] סוג ישות לא נתמך לקישור משימה:', linkType);
    }
    setBusy(false);
    nav(`/tasks/${data.id}`);
  }

  return (
    <>
      <PageHead title="משימה חדשה" />
      <form className="card" style={{ padding: 24, maxWidth: 600, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">כותרת *</span><input value={f.title} onChange={e => set('title', e.target.value)} required autoFocus /></label>
        <label><span className="lbl">תיאור</span><textarea value={f.description} onChange={e => set('description', e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label><span className="lbl">עדיפות</span>
            <select value={f.priority} onChange={e => set('priority', e.target.value)}>
              {Object.entries(TASK_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <label><span className="lbl">תאריך יעד</span><input type="datetime-local" value={f.due_at} onChange={e => set('due_at', e.target.value)} /></label>
        </div>
        <fieldset className="asg-set">
          <legend className="lbl">אחראים</legend>
          <div className="asg">
            {employees.map(e => (
              <label key={e.id} className={'asg-item' + (assignees.includes(e.id) ? ' on' : '')}>
                <input type="checkbox" checked={assignees.includes(e.id)} onChange={() => toggle(e.id)} style={{ width: 'auto', minHeight: 0 }} />
                {e.full_name}
              </label>
            ))}
          </div>
        </fieldset>
        <label><span className="lbl">כלל השלמה</span>
          <select value={f.completion_rule} onChange={e => set('completion_rule', e.target.value)}>
            {Object.entries(TASK_COMPLETION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
        <Msg kind="err">{err}</Msg>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/tasks')}>ביטול</button>
        </div>
        <style>{`
          .asg-set { border: 0; padding: 0; margin: 0; }
          .asg { display: flex; flex-wrap: wrap; gap: 8px; }
          .asg-item { display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px; border: 1px solid var(--line-strong); border-radius: 99px; cursor: pointer; font-size: .88rem; }
          .asg-item.on { background: var(--brand-soft); color: var(--brand-ink); border-color: transparent; }
        `}</style>
      </form>
    </>
  );
}
