import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AI_STATUS, formatDateTime, label, money } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { Msg } from './Msg';

// ניתוח קורות חיים ב-AI. מפעיל את פונקציית השרת analyze-cv, מציג את התוצאה
// כ"הצעות" ומאפשר למגייס להחיל שדות נבחרים על כרטיס המועמד — לעולם לא דורס
// אוטומטית; ברירת המחדל היא סימון רק שדות ריקים בכרטיס.

export interface CvDoc { id: string; kind: string; file_name: string; created_at: string }

interface Extracted {
  full_name: string | null; email: string | null; phone: string | null;
  years_experience: number | null; skills: string[] | null;
  desired_salary: number | null; availability: string | null;
}
interface Analysis {
  id: string; document_id: string; status: string; extracted: Extracted | null;
  summary: string | null; missing_fields: string[] | null; cost_usd: number | null;
  engine_version: string | null; created_at: string; completed_at: string | null; error: string | null;
}
export interface CandidateNow {
  full_name: string; email: string | null; phone_raw: string | null;
  years_experience: number | null; skills: string[] | null;
  desired_salary: number | null; availability: string | null;
}

const INVOKE_ERR: Record<string, string> = {
  ai_disabled: 'ניתוח AI כבוי. יש להפעיל אותו בהגדרות → AI.',
  quota_exceeded: 'נוצלה המכסה החודשית לניתוחי AI.',
  unsupported_file: 'סוג הקובץ אינו נתמך (רק PDF או DOCX).',
  empty_document: 'לא נמצא טקסט לקריאה במסמך.',
  ai_request_failed: 'שירות ה-AI החזיר שגיאה. נסו שוב בעוד רגע.',
  no_extraction: 'לא התקבל חילוץ מהמסמך. נסו שוב.',
  download_failed: 'הורדת הקובץ מהאחסון נכשלה.',
  server_misconfigured: 'שירות ה-AI לא הוגדר (חסר מפתח API).',
  forbidden: 'אין לך הרשאה לפעולה זו.',
  not_found: 'המסמך לא נמצא.',
};

const isEmpty = (v: unknown) =>
  v == null || v === '' || (Array.isArray(v) && v.length === 0);

export default function CvAnalysis(
  { candidateId, candidate, docs, onApplied }:
  { candidateId: string; candidate: CandidateNow; docs: CvDoc[]; onApplied: () => void },
) {
  const cvDocs = useMemo(() => docs.filter(d => d.kind === 'cv'), [docs]);
  const [rows, setRows] = useState<Analysis[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState<Record<string, boolean>>({});

  async function loadAnalyses() {
    if (cvDocs.length === 0) { setRows([]); return; }
    const ids = cvDocs.map(d => d.id);
    const r = await supabase.from('document_analyses')
      .select('id, document_id, status, extracted, summary, missing_fields, cost_usd, engine_version, created_at, completed_at, error')
      .in('document_id', ids).order('created_at', { ascending: false });
    if (r.error) { setErr(toUserMessage(r.error, 'טעינת ניתוחי ה-AI נכשלה.')); return; }
    const list = r.data as unknown as Analysis[];
    setRows(list);
    setActiveId(prev => prev && list.some(a => a.id === prev) ? prev : (list[0]?.id ?? null));
  }
  useEffect(() => { loadAnalyses(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [candidateId, docs]);

  const active = rows.find(a => a.id === activeId) ?? null;

  // בניית שורות ההצעה: רק שדות עם ערך מוצע ששונה מהקיים בכרטיס.
  const fields = useMemo(() => {
    const x = active?.extracted;
    if (!x) return [] as Array<{ key: string; col: string; label: string; cur: string; sug: string; value: unknown }>;
    const defs = [
      { key: 'full_name', col: 'full_name', label: 'שם מלא', cur: candidate.full_name, sug: x.full_name, value: x.full_name },
      { key: 'email', col: 'email', label: 'דוא״ל', cur: candidate.email, sug: x.email, value: x.email },
      { key: 'phone', col: 'phone_raw', label: 'טלפון', cur: candidate.phone_raw, sug: x.phone, value: x.phone },
      { key: 'years_experience', col: 'years_experience', label: 'ניסיון (שנים)', cur: candidate.years_experience, sug: x.years_experience, value: x.years_experience },
      { key: 'skills', col: 'skills', label: 'כישורים', cur: (candidate.skills ?? []).join(', '), sug: (x.skills ?? []).join(', '), value: x.skills ?? [] },
      { key: 'desired_salary', col: 'desired_salary', label: 'שכר רצוי', cur: candidate.desired_salary != null ? money(candidate.desired_salary, 'ILS', 0) : '', sug: x.desired_salary != null ? money(x.desired_salary, 'ILS', 0) : '', value: x.desired_salary },
      { key: 'availability', col: 'availability', label: 'זמינות', cur: candidate.availability, sug: x.availability, value: x.availability },
    ];
    return defs
      .filter(f => !isEmpty(f.value) && String(f.cur ?? '') !== String(f.sug ?? ''))
      .map(f => ({ key: f.key, col: f.col, label: f.label, cur: String(f.cur ?? ''), sug: String(f.sug ?? ''), value: f.value }));
  }, [active, candidate]);

  // ברירת מחדל: מסמנים רק שדות שריקים כרגע בכרטיס.
  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const f of fields) next[f.key] = f.cur === '';
    setSel(next); setMsg('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, rows]);

  async function analyze(docId: string) {
    setBusyDoc(docId); setErr(''); setMsg('');
    const { data, error } = await supabase.functions.invoke('analyze-cv', { body: { document_id: docId } });
    setBusyDoc(null);
    if (error) {
      let code = '';
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        code = (await ctx?.json?.())?.error ?? '';
      } catch { /* גוף לא-JSON */ }
      setErr(INVOKE_ERR[code] || 'ניתוח קורות החיים נכשל.');
      return;
    }
    const a = (data as { analysis?: Analysis } | null)?.analysis;
    if (a) { setRows(prev => [a, ...prev.filter(p => p.id !== a.id)]); setActiveId(a.id); }
    else await loadAnalyses();
  }

  async function applySelected() {
    const chosen = fields.filter(f => sel[f.key]);
    if (chosen.length === 0) return;
    setApplyBusy(true); setErr(''); setMsg('');
    const patch: Record<string, unknown> = {};
    for (const f of chosen) patch[f.col] = f.value;
    const { error } = await supabase.from('candidates').update(patch).eq('id', candidateId);
    setApplyBusy(false);
    if (error) { setErr(toUserMessage(error, 'החלת השדות נכשלה.')); return; }
    setMsg(`עודכנו ${chosen.length} שדות בכרטיס.`);
    onApplied();
  }

  const latestByDoc = new Map<string, Analysis>();
  for (const a of rows) if (!latestByDoc.has(a.document_id)) latestByDoc.set(a.document_id, a);

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">ניתוח קורות חיים (AI)</h2>
      <Msg kind="err">{err}</Msg>
      <Msg kind="ok">{msg}</Msg>

      {cvDocs.length === 0 ? (
        <p className="hint">אין קובץ קורות חיים לניתוח. יש להעלות קו״ח (PDF או DOCX) תחילה.</p>
      ) : (
        <ul className="linklist" style={{ marginBottom: fields.length || active ? 14 : 0 }}>
          {cvDocs.map(d => {
            const a = latestByDoc.get(d.id);
            return (
              <li key={d.id} className="cvrow">
                <span>
                  📄 {d.file_name}
                  {a && <span className={'tag ' + (a.status === 'done' ? 'ok' : a.status === 'failed' ? 'mute' : 'brand')} style={{ marginInlineStart: 8 }}>{label(AI_STATUS, a.status)}</span>}
                </span>
                <span className="row-actions">
                  {a && a.id !== activeId && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setActiveId(a.id)}>הצג</button>}
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyDoc !== null} onClick={() => analyze(d.id)}>
                    {busyDoc === d.id ? 'מנתח…' : a ? 'נתח מחדש' : 'נתח ב-AI'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {active && (
        <div className="cvresult">
          <p className="hint" style={{ marginTop: 0 }}>
            {label(AI_STATUS, active.status)}
            {active.engine_version ? ' · ' + active.engine_version : ''}
            {active.completed_at ? ' · ' + formatDateTime(active.completed_at) : ''}
            {active.cost_usd != null ? ` · עלות ~$${active.cost_usd}` : ''}
          </p>
          {active.status === 'failed' && <p className="hint">הניתוח נכשל{active.error ? ` (${active.error})` : ''}. אפשר לנסות שוב.</p>}
          {active.summary && <p style={{ marginTop: 8 }}>{active.summary}</p>}
          {active.missing_fields && active.missing_fields.length > 0 && (
            <p className="hint">שדות שלא נמצאו: {active.missing_fields.join(', ')}</p>
          )}

          {active.extracted && (
            fields.length === 0 ? (
              <p className="hint">אין הצעות חדשות מעבר למה שכבר קיים בכרטיס.</p>
            ) : (
              <>
                <table style={{ marginTop: 10 }}>
                  <thead><tr><th style={{ width: 32 }}></th><th>שדה</th><th>בכרטיס</th><th>הצעת AI</th></tr></thead>
                  <tbody>{fields.map(f => (
                    <tr key={f.key}>
                      <td><input type="checkbox" checked={!!sel[f.key]} onChange={e => setSel(s => ({ ...s, [f.key]: e.target.checked }))} style={{ width: 'auto', minHeight: 0 }} /></td>
                      <td>{f.label}</td>
                      <td className="hint">{f.cur || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{f.sug}</td>
                    </tr>
                  ))}</tbody>
                </table>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn btn-primary btn-sm" disabled={applyBusy || fields.every(f => !sel[f.key])} onClick={applySelected}>
                    {applyBusy ? 'מחיל…' : 'החל נבחרים על הכרטיס'}
                  </button>
                </div>
              </>
            )
          )}
        </div>
      )}

      <style>{`
        .cvrow { display: flex; justify-content: space-between; gap: 10px; align-items: center; }
        .cvrow .row-actions { display: inline-flex; gap: 6px; flex: 0 0 auto; }
        .cvresult { border-top: 1px solid var(--line); padding-top: 12px; }
      `}</style>
    </div>
  );
}
