import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// קטלוג היכולות. מקור אמת יחיד לתוויות — התאמה ל-enum app.perm_module/perm_action.
const MODULES: [string, string][] = [
  ['candidates', 'מועמדים'],
  ['jobs', 'משרות'],
  ['companies', 'חברות / לקוחות'],
  ['applications', 'מועמדויות'],
  ['placements', 'השמות'],
  ['invoicing', 'חיובים'],
  ['settlements', 'התחשבנות'],
  ['tasks', 'משימות'],
  ['candidate_messages', 'תקשורת עם מועמדים'],
  ['forms', 'בניית טפסים'],
  ['website', 'אתר ציבורי'],
  ['reports', 'דוחות'],
  ['imports', 'ייבוא נתונים'],
  ['users_permissions', 'משתמשים והרשאות'],
  ['org_settings', 'הגדרות ארגון'],
  ['system_settings', 'הגדרות מערכת'],
];
const ACTIONS: [string, string][] = [
  ['view', 'צפייה'],
  ['create', 'יצירה'],
  ['edit', 'עריכה'],
  ['delete', 'מחיקה'],
  ['export', 'ייצוא'],
  ['approve', 'אישור'],
];
const SCOPES: [string, string][] = [
  ['none', 'אין'],
  ['own', 'שלי'],
  ['team', 'צוות'],
  ['all', 'הכול'],
];
const SCOPE_LABEL: Record<string, string> = Object.fromEntries(SCOPES);
const MODULE_LABEL: Record<string, string> = Object.fromEntries(MODULES);
const ACTION_LABEL: Record<string, string> = Object.fromEntries(ACTIONS);
const ROLE_LABEL: Record<string, string> = { recruiter: 'מגייס', manager: 'מנהלת החברה', superadmin: 'מנהל על' };

type Row = { role: string; module: string; action: string; scope: string };
type Override = {
  id: string; employee_id: string; module: string; action: string;
  scope: string; kind: 'grant' | 'deny'; reason: string; valid_until: string | null;
};
type Emp = { id: string; full_name: string; role: string };

export default function PermissionsAdmin() {
  const { employee } = useAuth();
  const [sub, setSub] = useState<'defaults' | 'overrides'>('defaults');
  const [err, setErr] = useState('');
  const key = (r: string, m: string, a: string) => `${r}|${m}|${a}`;

  // ---------- ברירות מחדל לפי תפקיד ----------
  const [role, setRole] = useState('recruiter');
  const [defaults, setDefaults] = useState<Record<string, string>>({});

  async function loadDefaults() {
    const { data, error } = await supabase.from('permission_defaults').select('role, module, action, scope');
    if (error) { setErr(error.message); return; }
    const map: Record<string, string> = {};
    (data as Row[]).forEach(r => { map[key(r.role, r.module, r.action)] = r.scope; });
    setDefaults(map);
  }
  useEffect(() => { loadDefaults(); }, []);

  async function setDefault(module: string, action: string, scope: string) {
    setErr('');
    setDefaults(d => ({ ...d, [key(role, module, action)]: scope })); // אופטימי
    const { error } = await supabase.from('permission_defaults')
      .upsert({ role, module, action, scope }, { onConflict: 'role,module,action' });
    if (error) { setErr(error.message); loadDefaults(); }
  }

  // ---------- הרשאות פר-משתמש ----------
  const [emps, setEmps] = useState<Emp[]>([]);
  const [empId, setEmpId] = useState('');
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [form, setForm] = useState({ module: 'candidates', action: 'view', kind: 'grant', scope: 'all', reason: '', valid_until: '' });

  useEffect(() => {
    supabase.from('employees').select('id, full_name, role').eq('employment_status', 'active').order('full_name')
      .then(({ data, error }) => { if (error) setErr(error.message); else setEmps((data as Emp[]) ?? []); });
  }, []);

  async function loadOverrides(id: string) {
    if (!id) { setOverrides([]); return; }
    const { data, error } = await supabase.from('permission_overrides')
      .select('id, employee_id, module, action, scope, kind, reason, valid_until')
      .eq('employee_id', id).order('module');
    if (error) setErr(error.message); else setOverrides((data as Override[]) ?? []);
  }
  useEffect(() => { loadOverrides(empId); }, [empId]);

  async function addOverride() {
    setErr('');
    if (!empId) { setErr('בחרו עובד'); return; }
    if (!form.reason.trim()) { setErr('חובה לציין סיבה (נרשם ביומן)'); return; }
    const { error } = await supabase.from('permission_overrides').insert({
      employee_id: empId, module: form.module, action: form.action,
      scope: form.kind === 'deny' ? 'none' : form.scope, kind: form.kind,
      reason: form.reason.trim(), granted_by: employee?.id ?? null,
      valid_until: form.valid_until ? new Date(form.valid_until).toISOString() : null,
    });
    if (error) { setErr(error.message); return; }
    setForm({ ...form, reason: '', valid_until: '' });
    loadOverrides(empId);
  }

  async function removeOverride(id: string) {
    const { error } = await supabase.from('permission_overrides').delete().eq('id', id);
    if (error) setErr(error.message); else loadOverrides(empId);
  }

  const selectedEmp = emps.find(e => e.id === empId);

  return (
    <div>
      {err && <p className="msg err">{err}</p>}
      <div className="tabs">
        <button className={sub === 'defaults' ? 'on' : ''} onClick={() => setSub('defaults')}>ברירות מחדל לפי תפקיד</button>
        <button className={sub === 'overrides' ? 'on' : ''} onClick={() => setSub('overrides')}>הרשאות פר־משתמש</button>
      </div>

      {sub === 'defaults' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <div style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 600 }}>תפקיד:</label>
            <select value={role} onChange={e => setRole(e.target.value)} style={{ minHeight: 32, width: 'auto' }}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {role !== 'recruiter' && (
            <p className="hint" style={{ padding: '0 14px 10px' }}>
              מנהלת ומנהל על מקבלים הרשאה מלאה על כל המערכת אוטומטית — עריכה כאן משפיעה בעיקר על מגייסים.
            </p>
          )}
          <table style={{ minWidth: 640 }}>
            <thead><tr><th>יכולת</th>{ACTIONS.map(([a, l]) => <th key={a}>{l}</th>)}</tr></thead>
            <tbody>
              {MODULES.map(([m, ml]) => (
                <tr key={m}>
                  <td style={{ fontWeight: 600 }}>{ml}</td>
                  {ACTIONS.map(([a]) => (
                    <td key={a}>
                      <select
                        value={defaults[key(role, m, a)] ?? 'none'}
                        onChange={e => setDefault(m, a, e.target.value)}
                        style={{ minHeight: 30, width: 'auto' }}
                      >
                        {SCOPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint" style={{ padding: 14 }}>
            היקף: <b>אין</b> = חסום · <b>שלי</b> = רשומות שהעובד אחראי עליהן · <b>צוות</b> = כל הצוות · <b>הכול</b> = הארגון.
            שינוי נכנס לתוקף מיד. "בניית טפסים" שולטת מי רשאי לבנות/לערוך מבנה טפסים — שליחת טופס למועמד נעשית מהכרטיס ואינה תלויה בזה.
          </p>
        </div>
      )}

      {sub === 'overrides' && (
        <div className="card">
          <div style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontWeight: 600 }}>עובד:</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ minHeight: 32, width: 'auto' }}>
              <option value="">— בחרו —</option>
              {emps.map(e => <option key={e.id} value={e.id}>{e.full_name} ({ROLE_LABEL[e.role] ?? e.role})</option>)}
            </select>
          </div>

          {empId && (
            <>
              {selectedEmp && (selectedEmp.role === 'manager' || selectedEmp.role === 'superadmin') && (
                <p className="hint" style={{ padding: '0 14px 10px' }}>
                  לעובד זה הרשאה מלאה מתוקף תפקידו; עקיפות רלוונטיות בעיקר למגייסים.
                </p>
              )}

              <div style={{ padding: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', alignItems: 'end' }}>
                <div>
                  <label className="hint">יכולת</label>
                  <select value={form.module} onChange={e => setForm({ ...form, module: e.target.value })} style={{ minHeight: 32 }}>
                    {MODULES.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="hint">פעולה</label>
                  <select value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} style={{ minHeight: 32 }}>
                    {ACTIONS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="hint">סוג</label>
                  <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })} style={{ minHeight: 32 }}>
                    <option value="grant">הענקה</option>
                    <option value="deny">שלילה</option>
                  </select>
                </div>
                <div>
                  <label className="hint">היקף</label>
                  <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} disabled={form.kind === 'deny'} style={{ minHeight: 32 }}>
                    {SCOPES.filter(([k]) => k !== 'none').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="hint">בתוקף עד (רשות)</label>
                  <input type="date" value={form.valid_until} onChange={e => setForm({ ...form, valid_until: e.target.value })} style={{ minHeight: 32 }} />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                  <input placeholder="סיבה (חובה, נרשם ביומן)" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} style={{ minHeight: 32, flex: 1 }} />
                  <button className="btn" onClick={addOverride}>הוסף</button>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ minWidth: 620 }}>
                  <thead><tr><th>יכולת</th><th>פעולה</th><th>סוג</th><th>היקף</th><th>בתוקף עד</th><th>סיבה</th><th></th></tr></thead>
                  <tbody>
                    {overrides.length === 0 && <tr><td colSpan={7} className="hint" style={{ padding: 14 }}>אין עקיפות לעובד זה.</td></tr>}
                    {overrides.map(o => (
                      <tr key={o.id}>
                        <td>{MODULE_LABEL[o.module] ?? o.module}</td>
                        <td>{ACTION_LABEL[o.action] ?? o.action}</td>
                        <td><span className={'tag ' + (o.kind === 'deny' ? 'mute' : 'brand')}>{o.kind === 'deny' ? 'שלילה' : 'הענקה'}</span></td>
                        <td>{o.kind === 'deny' ? '—' : (SCOPE_LABEL[o.scope] ?? o.scope)}</td>
                        <td>{o.valid_until ? new Date(o.valid_until).toLocaleDateString('he-IL') : 'ללא הגבלה'}</td>
                        <td>{o.reason}</td>
                        <td><button className="iconbtn" onClick={() => removeOverride(o.id)} title="הסר">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="hint" style={{ padding: 14 }}>
                שלילה (deny) גוברת על כל הענקה — גם על ברירת המחדל של התפקיד וגם על פרופיל. עקיפה שפג תוקפה מתעלמים ממנה.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
