import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { APP_STAGE } from '../lib/format';
import PageHead from '../components/PageHead';
import CustomFieldsAdmin from '../components/CustomFieldsAdmin';
import PermissionsAdmin from '../components/PermissionsAdmin';

const ROLE: Record<string,string> = { recruiter:'מגייס', manager:'מנהלת החברה', superadmin:'מנהל על' };
const EMP_STATUS: Record<string,string> = { active:'פעיל', suspended:'מושבת', ended:'סיים' };

export default function Settings() {
  const { employee } = useAuth();
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';
  const [tab, setTab] = useState<'users'|'permissions'|'stages'|'fields'>('users');
  const [emps, setEmps] = useState<any[]>([]);
  const [stages, setStages] = useState<any[]>([]);
  const [err, setErr] = useState('');

  async function load() {
    const [e, s] = await Promise.all([
      supabase.from('employees').select('id, full_name, email, role, employment_status, team_id').order('full_name'),
      supabase.from('stage_exposure').select('*').order('stage'),
    ]);
    if (e.error) setErr(e.error.message); else setEmps(e.data);
    if (!s.error) setStages(s.data);
  }
  useEffect(() => { load(); }, []);

  async function setRole(id: string, role: string) { const { error } = await supabase.from('employees').update({ role }).eq('id', id); if (error) setErr(error.message); else load(); }
  async function setStatus(id: string, employment_status: string) { const { error } = await supabase.from('employees').update({ employment_status }).eq('id', id); if (error) setErr(error.message); else load(); }
  async function saveStage(stage: string, patch: any) { const { error } = await supabase.from('stage_exposure').update(patch).eq('stage', stage); if (error) setErr(error.message); else load(); }

  if (!isMgr) return <><PageHead title="הגדרות" /><p className="msg err">רק מנהלת המערכת רשאית לגשת להגדרות.</p></>;

  return (
    <>
      <PageHead title="הגדרות" sub="ניהול המערכת" />
      {err && <p className="msg err">{err}</p>}
      <div className="tabs">
        <button className={tab==='users'?'on':''} onClick={()=>setTab('users')}>משתמשים</button>
        <button className={tab==='permissions'?'on':''} onClick={()=>setTab('permissions')}>הרשאות</button>
        <button className={tab==='stages'?'on':''} onClick={()=>setTab('stages')}>חשיפת שלבים למועמד</button>
        <button className={tab==='fields'?'on':''} onClick={()=>setTab('fields')}>שדות מותאמים</button>
      </div>

      {tab==='permissions' && <PermissionsAdmin />}
      {tab==='fields' && <CustomFieldsAdmin />}

      {tab==='users' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 560 }}>
            <thead><tr><th>שם</th><th>דוא״ל</th><th>תפקיד</th><th>מצב</th></tr></thead>
            <tbody>{emps.map(e => (
              <tr key={e.id}>
                <td style={{ fontWeight: 600 }}>{e.full_name}</td>
                <td>{e.email}</td>
                <td><select value={e.role} onChange={ev=>setRole(e.id, ev.target.value)} style={{ minHeight: 32 }}>
                  {Object.entries(ROLE).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
                <td><select value={e.employment_status} onChange={ev=>setStatus(e.id, ev.target.value)} style={{ minHeight: 32 }}>
                  {Object.entries(EMP_STATUS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="hint" style={{ padding: 14 }}>הזמנת עובד חדש: יוצרים משתמש ב-Supabase Authentication ואז מקשרים עם הפונקציה app.link_employee. חיבור מלא מתוך המסך יתווסף בהמשך.</p>
        </div>
      )}

      {tab==='stages' && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 760 }}>
            <thead><tr><th>שלב פנימי</th><th>נחשף למועמד</th><th>תווית למועמד</th><th>טקסט הסבר</th><th>מה המועמד רואה</th></tr></thead>
            <tbody>{stages.map(s => (
              <tr key={s.stage}>
                <td style={{ fontWeight: 600 }}>{APP_STAGE[s.stage] ?? s.stage}<div className="hint" dir="ltr" style={{ textAlign:'start' }}>{s.stage}</div></td>
                <td><input type="checkbox" checked={s.exposed} onChange={e=>saveStage(s.stage, { exposed: e.target.checked })} style={{ width:'auto', minHeight:0 }} /></td>
                <td><input defaultValue={s.candidate_label ?? ''} disabled={!s.exposed} onBlur={e=>saveStage(s.stage, { candidate_label: e.target.value || null })} placeholder="—" style={{ minHeight: 32 }} /></td>
                <td><input defaultValue={s.explanation ?? ''} disabled={!s.exposed} onBlur={e=>saveStage(s.stage, { explanation: e.target.value || null })} placeholder="—" style={{ minHeight: 32 }} /></td>
                <td><span className={'tag '+(s.exposed?'brand':'mute')}>{s.exposed ? (s.candidate_label || 'בתהליך') : 'בטיפול'}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <p className="hint" style={{ padding: 14 }}>מה שמוגדר כאן קובע מה מועמד רואה באזור האישי. שלב שאינו "נחשף" מוצג למועמד תמיד כ"בטיפול", והשם הפנימי לעולם אינו מגיע אליו. שינוי נכנס לתוקף מיד.</p>
        </div>
      )}
    </>
  );
}
