import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/errors';
import { useTitle } from '../lib/useTitle';

// מילוי טופס חיצוני לפי token — ללא התחברות. משמש כל נמען (מועמד/עובד/לקוח/כללי).
interface Field {
  key: string; type: string; label?: string; help?: string; required?: boolean;
  order?: number; options?: { value: string; label: string }[];
  show_if?: { field: string; equals: string };
}
interface Def { fields?: Field[] }
export type AnswerValue = string | number | boolean | string[] | null;
type Answers = Record<string, AnswerValue>;

interface FormMeta {
  name: string;
  description?: string | null;
  definition?: Def | null;
  answers?: Answers | null;
  completed: boolean;
}

const STATIC_TYPES = ['heading', 'paragraph'];
const SIG_PREFIX = 'data:image';
const MAX_TEXT = 4000;

/** ולידציה לפי טיפוס — השרת שומר את ה-jsonb כמות שהוא ולא בודק. */
function fieldError(f: Field, v: AnswerValue): string | null {
  const label = f.label || f.key;
  // false של checkbox חובה הוא "לא מולא" — הבדיקה הישנה פספסה בדיוק את זה.
  const empty = v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
  if (f.required && empty) return `נא למלא: ${label}`;
  if (empty) return null;

  const s = typeof v === 'string' ? v.trim() : '';
  switch (f.type) {
    case 'number':
      if (!/^-?\d+(\.\d+)?$/.test(String(v))) return `${label}: נא להזין מספר.`;
      return null;
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${label}: תאריך אינו תקין.`;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? `${label}: תאריך אינו תקין.` : null;
    }
    case 'time':
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(s) ? null : `${label}: שעה אינה תקינה.`;
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? null : `${label}: כתובת דוא״ל אינה תקינה.`;
    case 'tel':
      return /^[\d+\-() ]{6,20}$/.test(s) ? null : `${label}: מספר טלפון אינו תקין.`;
    default:
      if (typeof v === 'string' && v.length > MAX_TEXT) return `${label}: הטקסט ארוך מדי.`;
      return null;
  }
}

export default function FormFill() {
  const { token: rawToken } = useParams<{ token: string }>();
  // decodeURIComponent על נתיב פגום זורק URIError — כאן הוא מוגן.
  let token = rawToken ?? '';
  try { token = decodeURIComponent(token); } catch { /* משאירים כמות שהוא */ }

  const [meta, setMeta] = useState<FormMeta | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [err, setErr] = useState('');
  const [state, setState] = useState<'load' | 'fill' | 'done' | 'error'>('load');
  const [busy, setBusy] = useState(false);
  const [savedNote, setSavedNote] = useState('');
  const [dirty, setDirty] = useState(false);
  const errRef = useRef<HTMLParagraphElement>(null);

  useTitle(meta?.name || 'מילוי טופס');

  useEffect(() => {
    if (!token) { setErr('הקישור אינו תקין.'); setState('error'); return; }
    supabase.rpc('form_open', { p_token: token }).then(({ data, error }) => {
      if (error) {
        setErr(reportError('form_open', error, 'טעינת הטופס נכשלה. נסו שוב בעוד רגע.'));
        setState('error'); return;
      }
      if (!data) { setErr('הטופס לא נמצא או שהקישור אינו תקין.'); setState('error'); return; }
      const m = data as FormMeta;
      setMeta(m);
      setAnswers((m.answers ?? {}) as Answers);
      setState(m.completed ? 'done' : 'fill');
    });
  }, [token]);

  // אזהרה לפני יציאה עם שינויים שלא נשמרו.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const fields = (meta?.definition?.fields ?? []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const visible = useCallback(
    (f: Field) => !f.show_if || String(answers[f.show_if.field] ?? '') === String(f.show_if.equals),
    [answers],
  );
  const set = (k: string, v: AnswerValue) => { setDirty(true); setAnswers(a => ({ ...a, [k]: v })); };

  const focusError = () => setTimeout(() => errRef.current?.focus(), 0);

  async function save() {
    setBusy(true); setSavedNote(''); setErr('');
    // בשמירת טיוטה שומרים הכול, כדי שערכים של שדות מוסתרים לא יאבדו.
    const { error } = await supabase.rpc('form_save', { p_token: token, p_answers: answers });
    setBusy(false);
    if (error) { setErr(reportError('form_save', error, 'השמירה נכשלה. נסו שוב.')); focusError(); return; }
    setDirty(false);
    setSavedNote('נשמר. אפשר להמשיך מאוחר יותר מאותו קישור.');
  }

  async function submit() {
    setErr(''); setSavedNote('');
    const shown = fields.filter(f => visible(f) && !STATIC_TYPES.includes(f.type));
    for (const f of shown) {
      const msg = fieldError(f, answers[f.key] ?? null);
      if (msg) {
        setErr(msg);
        focusError();
        document.getElementById(`ff-${f.key}`)?.focus();
        return;
      }
    }
    // שדות שהוסתרו ע"י show_if לא נשלחים — form_submit שומר הכול ללא סינון.
    const payload: Answers = {};
    for (const f of shown) if (f.key in answers) payload[f.key] = answers[f.key];

    setBusy(true);
    const { error } = await supabase.rpc('form_submit', { p_token: token, p_answers: payload });
    setBusy(false);
    if (error) { setErr(reportError('form_submit', error, 'השליחה נכשלה. נסו שוב.')); focusError(); return; }
    setDirty(false);
    setState('done');
  }

  if (state === 'load') return <div className="screen-center"><div className="spinner" role="status" aria-label="טוען" /></div>;
  if (state === 'error') return (
    <div className="ff-wrap"><div className="card ff"><p className="msg err" role="alert">{err}</p></div></div>
  );
  if (state === 'done') return (
    <div className="ff-wrap"><div className="card ff" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 46 }} aria-hidden="true">✅</div>
      <h1>{meta?.name}</h1>
      <p className="sub" role="status">הטופס נשלח בהצלחה. תודה!</p>
    </div></div>
  );

  return (
    <div className="ff-wrap">
      <form className="card ff" onSubmit={e => { e.preventDefault(); void submit(); }} noValidate>
        <img className="ff-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>{meta?.name}</h1>
        {meta?.description && <p className="sub">{meta.description}</p>}
        <p className="sub req-note">שדות המסומנים ב־<span className="req">חובה</span> הם שדות חובה.</p>
        <div className="ff-fields">
          {fields.filter(visible).map(f => (
            <FieldView key={f.key} f={f} value={answers[f.key] ?? null} onChange={v => set(f.key, v)} />
          ))}
        </div>
        {err && <p className="msg err" role="alert" tabIndex={-1} ref={errRef}>{err}</p>}
        {savedNote && <p className="msg ok" role="status" aria-live="polite">{savedNote}</p>}
        <div className="ff-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void save()}>שמירה להמשך</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'רגע…' : 'שליחה'}</button>
        </div>
      </form>
      <style>{`
        .ff-wrap { min-height:100vh; display:grid; place-items:start center; padding:22px 16px 60px; }
        .ff { width:100%; max-width:560px; display:flex; flex-direction:column; gap:14px; margin-top:20px; }
        .ff-logo { height:34px; width:auto; margin-inline:auto; }
        .ff h1 { font-family:var(--disp); font-size:1.4rem; color:var(--navy); text-align:center; margin:4px 0 0; }
        .ff .sub { text-align:center; color:var(--ink-mid); margin:0; }
        .ff .req-note { font-size:.82rem; }
        .ff-fields { display:flex; flex-direction:column; gap:16px; margin-top:6px; }
        .ff-actions { display:flex; gap:10px; margin-top:6px; }
        .btn-ghost { background:var(--surface); color:var(--navy); border:1.5px solid var(--line); }
        .ff fieldset { border:0; padding:0; margin:0; min-inline-size:0; }
        .ff legend { padding:0; }
      `}</style>
    </div>
  );
}

// ---------- שדה בודד ----------
function FieldView({ f, value, onChange }: { f: Field; value: AnswerValue; onChange: (v: AnswerValue) => void }) {
  const id = `ff-${f.key}`;
  const helpId = f.help ? `${id}-help` : undefined;

  if (f.type === 'heading') return <h2 className="ff-heading">{f.label}</h2>;
  if (f.type === 'paragraph') return <p className="sub" style={{ textAlign: 'start' }}>{f.help || f.label}</p>;

  // סימון החובה אינו בצבע בלבד — יש גם טקסט "חובה" (WCAG 1.4.1).
  const labelText = <>{f.label}{f.required && <span className="req"> (חובה)</span>}</>;
  const help = f.help ? <span className="hint" id={helpId}>{f.help}</span> : null;
  const common = {
    id,
    'aria-describedby': helpId,
    'aria-required': f.required || undefined,
  } as const;
  const str = typeof value === 'string' ? value : value == null ? '' : String(value);

  switch (f.type) {
    case 'textarea':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <textarea {...common} value={str} maxLength={MAX_TEXT} rows={3} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'number':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="number" inputMode="decimal" dir="ltr" value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'date':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="date" value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'time':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="time" value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'email':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="email" dir="ltr" autoComplete="email" value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'tel':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="tel" dir="ltr" autoComplete="tel" value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
    case 'boolean':
      return <div className="field">
        <div className="row-check">
          <input {...common} type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} />
          <label className="lbl" htmlFor={id}>{labelText}</label>
        </div>{help}</div>;
    case 'select':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <select {...common} value={str} onChange={e => onChange(e.target.value)}>
          <option value="">בחרו…</option>
          {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>{help}</div>;
    case 'multiselect': {
      const arr: string[] = Array.isArray(value) ? value : [];
      return <fieldset aria-describedby={helpId}>
        <legend className="lbl">{labelText}</legend>
        <div className="check-grid" id={id} tabIndex={-1}>
          {(f.options || []).map(o => (
            <div className="row-check" key={o.value}>
              <input type="checkbox" id={`${id}-${o.value}`} checked={arr.includes(o.value)}
                onChange={e => onChange(e.target.checked ? [...arr, o.value] : arr.filter(x => x !== o.value))} />
              <label htmlFor={`${id}-${o.value}`}>{o.label}</label>
            </div>
          ))}
        </div>{help}</fieldset>;
    }
    case 'list':
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <textarea {...common} rows={3} placeholder="פריט אחד בכל שורה"
          value={Array.isArray(value) ? value.join('\n') : str}
          onChange={e => onChange(e.target.value.split('\n').filter(Boolean))} />{help}</div>;
    case 'signature':
      return <SignatureField f={f} id={id} helpId={helpId} label={labelText} value={str} onChange={onChange} help={help} />;
    default:
      return <div className="field"><label className="lbl" htmlFor={id}>{labelText}</label>
        <input {...common} type="text" maxLength={MAX_TEXT} value={str} onChange={e => onChange(e.target.value)} />{help}</div>;
  }
}

// ---------- חתימה ----------
// הערך הוא מחרוזת: data URL כשציירו, או השם המלא שהוקלד כאישור.
function SignatureField({ f, id, helpId, label, value, onChange, help }: {
  f: Field; id: string; helpId?: string; label: React.ReactNode;
  value: string; onChange: (v: AnswerValue) => void; help: React.ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drawn = value.startsWith(SIG_PREFIX);
  const typed = drawn ? '' : value;

  // הערך ההתחלתי נלכד ב-ref: ציור מחדש בכל שינוי ערך היה מוחק את הקו
  // שבדיוק מציירים, ולכן האפקט רץ פעם אחת בלבד — בלי תלות משתנה.
  const initial = useRef(value);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.strokeStyle = '#0d1230'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const src = initial.current;
    if (src.startsWith(SIG_PREFIX)) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = src;
    }
  }, []);

  // ה-canvas הוא 520×160 פנימית אך נמתח ל-100% ברוחב. בלי הסקיילינג
  // הקו נופל בערך ב-63% מהמרחק מהאצבע במסך 360px.
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!; const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };
  const ctxOf = () => ref.current?.getContext('2d') ?? null;
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = ctxOf(); if (!ctx) return;
    ref.current?.setPointerCapture?.(e.pointerId);
    drawing.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return; const ctx = ctxOf(); if (!ctx) return;
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    const c = ref.current; if (c) onChange(c.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current; const ctx = ctxOf();
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    onChange(null);
  };

  return (
    <fieldset aria-describedby={helpId}>
      <legend className="lbl">{label}</legend>

      <canvas ref={ref} width={520} height={160} className="sig-canvas"
        role="img" aria-label={`אזור חתימה — ${f.label || 'חתימה'}. אפשר לחתום בעכבר או באצבע, או להקליד שם מלא כאישור בשדה שמתחת.`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}
        onPointerCancel={up} onPointerLeave={up} />

      <button type="button" className="linkish" onClick={clear} style={{ marginTop: 4 }}>ניקוי חתימה</button>

      {/* חלופה שאינה דורשת ציור (WCAG 2.1.1) — מקלדת, קורא מסך, ומי שאין לו מסך מגע. */}
      <div className="field" style={{ marginTop: 10 }}>
        <label className="lbl" htmlFor={id}>או הקלדת השם המלא כאישור</label>
        <input id={id} type="text" maxLength={120} value={typed} disabled={drawn}
          autoComplete="name" aria-describedby={helpId}
          onChange={e => onChange(e.target.value || null)} />
        {drawn && <span className="hint">קיימת חתימה מצוירת. לניקוי — "ניקוי חתימה".</span>}
      </div>
      {help}
    </fieldset>
  );
}
