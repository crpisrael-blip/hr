import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth, isSuperadmin } from '../lib/auth';
import { isTaskLinkEntity } from '../lib/entities';
import { toUserMessage } from '../lib/errors';
import { effectiveFields, TASK_BUILTINS, type RenderField, type Slot } from '../lib/formLayout';
import type { CustomField } from '../components/CustomFields';
import FieldInput from '../components/FieldInput';
import FormLayoutEditor from '../components/FormLayoutEditor';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg } from '../components/Msg';

interface EmployeeOption { id: string; full_name: string }
const SPAN: Record<string, number> = { full: 6, half: 3, third: 2 };

export default function TaskNew() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { employee } = useAuth();
  const meId = employee?.id ?? null;
  const canBuild = isSuperadmin(employee);

  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [custom, setCustom] = useState<CustomField[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [values, setValues] = useState<Record<string, any>>({ 'builtin:priority': 'normal', 'builtin:completion_rule': 'all_assignees' });
  const [assignees, setAssignees] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const fields = useMemo(() => effectiveFields(TASK_BUILTINS, custom, slots), [custom, slots]);

  async function reloadMeta() {
    const [cf, lay] = await Promise.all([
      supabase.from('custom_fields').select('*').eq('entity_type', 'task').eq('active', true).order('sort'),
      supabase.from('form_layouts').select('slots').eq('entity_type', 'task').maybeSingle(),
    ]);
    if (!cf.error) setCustom((cf.data as CustomField[]) ?? []);
    setSlots((lay.data?.slots as Slot[]) ?? []);
  }

  useEffect(() => {
    let alive = true;
    supabase.from('employees').select('id, full_name').eq('employment_status', 'active').order('full_name')
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת העובדים נכשלה.')); return; }
        setEmployees(r.data as EmployeeOption[]);
      });
    reloadMeta();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (meId) setAssignees(a => (a.length ? a : [meId])); }, [meId]);

  const setVal = (ref: string, v: any) => setValues(s => ({ ...s, [ref]: v }));
  function toggle(id: string) { setAssignees(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]); }

  function coerce(f: RenderField, v: any): unknown {
    if (f.column === 'due_at') return v ? new Date(v).toISOString() : null;
    if (f.widget === 'number') return v ? Number(v) : null;
    if (f.widget === 'boolean') return !!v;
    if (f.widget === 'multiselect') return Array.isArray(v) ? v : [];
    return (typeof v === 'string' ? v.trim() : v) || null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr('');
    const visible = fields.filter(f => !f.hidden);
    for (const f of visible) {
      const v = values[f.ref];
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (f.required && empty) { setErr(`שדה חובה: ${f.label}.`); return; }
    }

    const body: Record<string, unknown> = { source: 'manual', created_by: meId };
    const customObj: Record<string, unknown> = {};
    for (const f of visible) {
      if (f.kind === 'builtin') body[f.column!] = coerce(f, values[f.ref]);
      else customObj[f.cfKey!] = f.widget === 'boolean' ? !!values[f.ref] : (values[f.ref] ?? null);
    }
    body.custom = customObj;

    setBusy(true);
    const { data, error } = await supabase.from('tasks').insert(body).select('id').single();
    if (error || !data) { setErr(toUserMessage(error, 'יצירת המשימה נכשלה.')); setBusy(false); return; }

    const list = assignees.length ? assignees : (meId ? [meId] : []);
    if (list.length) {
      const ins = await supabase.from('task_assignees')
        .insert(list.map(eid => ({ task_id: data.id, employee_id: eid, added_by: meId })));
      if (ins.error) { setBusy(false); setErr(toUserMessage(ins.error, 'המשימה נוצרה אך שיוך האחראים נכשל. פתחו את המשימה והוסיפו אחראים.')); return; }
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
      <PageHead title="משימה חדשה"
        action={canBuild ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditorOpen(true)}>✎ עריכת מבנה הטופס</button> : undefined} />
      <form className="card" style={{ padding: 24, maxWidth: 620, display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 16 }} onSubmit={onSubmit}>
        {fields.filter(f => !f.hidden).map(f => (
          <div key={f.ref} style={{ gridColumn: `span ${SPAN[f.width] ?? 6}` }}>
            <FieldInput field={f} value={values[f.ref]} onChange={v => setVal(f.ref, v)} />
          </div>
        ))}
        <fieldset className="asg-set" style={{ gridColumn: '1 / -1' }}>
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
        <div style={{ gridColumn: '1 / -1' }}><Msg kind="err">{err}</Msg></div>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10 }}>
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

      {canBuild && (
        <Dialog open={editorOpen} title="עריכת מבנה הטופס — משימה" wide
          description="סדר, הסתרה, רוחב ותווית לשדות המובנים; הוספה/עריכה/מחיקה של שדות מכל סוג. האחראים מנוהלים בקטע נפרד."
          onClose={() => { setEditorOpen(false); reloadMeta(); }}
          footer={<button type="button" className="btn btn-primary" onClick={() => { setEditorOpen(false); reloadMeta(); }}>סיום</button>}>
          <FormLayoutEditor entityType="task" builtins={TASK_BUILTINS} />
        </Dialog>
      )}
    </>
  );
}
