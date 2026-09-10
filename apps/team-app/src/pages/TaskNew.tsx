import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import PageHead from '../components/PageHead';

export default function TaskNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [employees, setEmployees] = useState<any[]>([]);
  const [f, setF] = useState({ title: '', description: '', priority: 'normal', due_at: '', completion_rule: 'all_assignees' });
  const [assignees, setAssignees] = useState<string[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => {
    supabase.from('employees').select('id, full_name, user_id').eq('employment_status', 'active').order('full_name')
      .then(async r => {
        if (!r.error) setEmployees(r.data);
        const uid = (await supabase.auth.getUser()).data.user?.id;
        const me = (r.data ?? []).find((e: any) => e.user_id === uid);
        if (me) setAssignees([me.id]);
      });
  }, []);

  function toggle(id: string) { setAssignees(a => a.includes(id) ? a.filter(x=>x!==id) : [...a, id]); }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const uid = (await supabase.auth.getUser()).data.user?.id;
    const me = employees.find(x => x.user_id === uid);
    const { data, error } = await supabase.from('tasks').insert({
      title: f.title.trim(), description: f.description.trim() || null, priority: f.priority,
      due_at: f.due_at ? new Date(f.due_at).toISOString() : null, completion_rule: f.completion_rule,
      source: 'manual', created_by: me?.id ?? null,
    }).select('id').single();
    if (error) { setErr(error.message); setBusy(false); return; }
    const list = assignees.length ? assignees : (me ? [me.id] : []);
    if (list.length) {
      await supabase.from('task_assignees').insert(list.map(eid => ({ task_id: data!.id, employee_id: eid, added_by: me?.id ?? null })));
    }
    // קישור לישות אם הגענו עם פרמטר
    const linkType = sp.get('type'); const linkId = sp.get('id');
    if (linkType && linkId) await supabase.from('task_links').insert({ task_id: data!.id, entity_type: linkType, entity_id: linkId });
    setBusy(false); nav('/tasks');
  }

  return (
    <>
      <PageHead title="משימה חדשה" />
      <form className="card" style={{ padding: 24, maxWidth: 600, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">כותרת *</span><input value={f.title} onChange={e=>set('title',e.target.value)} required autoFocus /></label>
        <label><span className="lbl">תיאור</span><textarea value={f.description} onChange={e=>set('description',e.target.value)} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label><span className="lbl">עדיפות</span>
            <select value={f.priority} onChange={e=>set('priority',e.target.value)}>
              <option value="low">נמוכה</option><option value="normal">רגילה</option><option value="high">גבוהה</option><option value="urgent">דחוף</option>
            </select></label>
          <label><span className="lbl">תאריך יעד</span><input type="datetime-local" value={f.due_at} onChange={e=>set('due_at',e.target.value)} /></label>
        </div>
        <div>
          <span className="lbl">אחראים</span>
          <div className="asg">
            {employees.map(e => (
              <label key={e.id} className={'asg-item' + (assignees.includes(e.id) ? ' on' : '')}>
                <input type="checkbox" checked={assignees.includes(e.id)} onChange={()=>toggle(e.id)} style={{ width: 'auto', minHeight: 0 }} />
                {e.full_name}
              </label>
            ))}
          </div>
        </div>
        <label><span className="lbl">כלל השלמה</span>
          <select value={f.completion_rule} onChange={e=>set('completion_rule',e.target.value)}>
            <option value="all_assignees">כל האחראים צריכים לבצע</option>
            <option value="any_assignee">אחראי אחד מספיק</option>
          </select></label>
        {err && <p className="msg err">{err}</p>}
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={()=>nav('/tasks')}>ביטול</button>
        </div>
        <style>{`.asg{display:flex;flex-wrap:wrap;gap:8px}.asg-item{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border:1px solid var(--line-strong);border-radius:99px;cursor:pointer;font-size:.88rem}.asg-item.on{background:var(--brand-soft);color:var(--brand-ink);border-color:transparent}`}</style>
      </form>
    </>
  );
}
