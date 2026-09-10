import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// מילוי טופס חיצוני לפי token — ללא התחברות. משמש כל נמען (מועמד/עובד/לקוח/כללי).
interface Field {
  key: string; type: string; label?: string; help?: string; required?: boolean;
  order?: number; options?: { value: string; label: string }[];
  show_if?: { field: string; equals: string };
}
interface Def { fields: Field[]; }
type Answers = Record<string, any>;

export default function FormFill({ token }: { token: string }) {
  const [meta, setMeta] = useState<{ name: string; description?: string; definition: Def; completed: boolean } | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [err, setErr] = useState(''); const [state, setState] = useState<'load'|'fill'|'done'|'error'>('load');
  const [busy, setBusy] = useState(false); const [savedNote, setSavedNote] = useState('');

  useEffect(() => {
    supabase.rpc('form_open', { p_token: token }).then(({ data, error }) => {
      if (error || !data) { setErr('הטופס לא נמצא או שהקישור אינו תקין.'); setState('error'); return; }
      setMeta(data as any); setAnswers((data as any).answers || {});
      setState((data as any).completed ? 'done' : 'fill');
    });
  }, [token]);

  const fields = (meta?.definition?.fields || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const visible = (f: Field) => !f.show_if || String(answers[f.show_if.field] ?? '') === String(f.show_if.equals);
  const set = (k: string, v: any) => setAnswers(a => ({ ...a, [k]: v }));

  async function save() {
    setBusy(true); setSavedNote('');
    const { error } = await supabase.rpc('form_save', { p_token: token, p_answers: answers });
    setBusy(false);
    setSavedNote(error ? 'שמירה נכשלה' : 'נשמר. אפשר להמשיך מאוחר יותר מאותו קישור.');
  }
  async function submit() {
    setErr('');
    for (const f of fields) {
      if (visible(f) && f.required && !['heading','paragraph'].includes(f.type)) {
        const v = answers[f.key];
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) { setErr(`נא למלא: ${f.label || f.key}`); return; }
      }
    }
    setBusy(true);
    const { error } = await supabase.rpc('form_submit', { p_token: token, p_answers: answers });
    setBusy(false);
    if (error) { setErr('השליחה נכשלה. נסו שוב.'); return; }
    setState('done');
  }

  if (state === 'load') return <div className="screen-center"><div className="spinner" /></div>;
  if (state === 'error') return <div className="ff-wrap"><div className="card ff"><p className="msg err">{err}</p></div></div>;
  if (state === 'done') return (
    <div className="ff-wrap"><div className="card ff" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 46 }}>✅</div>
      <h1>{meta?.name}</h1>
      <p className="sub">הטופס נשלח בהצלחה. תודה!</p>
    </div></div>
  );

  return (
    <div className="ff-wrap">
      <form className="card ff" onSubmit={e => { e.preventDefault(); submit(); }}>
        <img className="ff-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>{meta?.name}</h1>
        {meta?.description && <p className="sub">{meta.description}</p>}
        <div className="ff-fields">
          {fields.filter(visible).map(f => <FieldView key={f.key} f={f} value={answers[f.key]} onChange={v => set(f.key, v)} />)}
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}
        {savedNote && <p className="msg ok" aria-live="polite">{savedNote}</p>}
        <div className="ff-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={save}>שמירה להמשך</button>
          <button className="btn btn-primary" disabled={busy}>{busy ? '…' : 'שליחה'}</button>
        </div>
      </form>
      <style>{`
        .ff-wrap { min-height:100vh; display:grid; place-items:start center; padding:22px 16px 60px; }
        .ff { width:100%; max-width:560px; display:flex; flex-direction:column; gap:14px; margin-top:20px; }
        .ff-logo { height:34px; width:auto; margin-inline:auto; }
        .ff h1 { font-family:var(--disp); font-size:1.4rem; color:var(--navy); text-align:center; margin:4px 0 0; }
        .ff .sub { text-align:center; color:var(--ink-mid); margin:0; }
        .ff-fields { display:flex; flex-direction:column; gap:16px; margin-top:6px; }
        .ff-actions { display:flex; gap:10px; margin-top:6px; }
        .ff-actions .btn { flex:1; }
        .btn-ghost { background:var(--surface); color:var(--navy); border:1.5px solid var(--line); }
      `}</style>
    </div>
  );
}

function FieldView({ f, value, onChange }: { f: Field; value: any; onChange: (v: any) => void }) {
  if (f.type === 'heading') return <h2 style={{ color: 'var(--navy)', margin: '8px 0 0', fontSize: '1.1rem' }}>{f.label}</h2>;
  if (f.type === 'paragraph') return <p className="sub" style={{ textAlign: 'start' }}>{f.help || f.label}</p>;

  const label = <span className="lbl">{f.label}{f.required && <span style={{ color: 'var(--warn)' }}> *</span>}</span>;
  const help = f.help ? <span className="hint">{f.help}</span> : null;

  switch (f.type) {
    case 'textarea':
      return <label>{label}<textarea value={value ?? ''} onChange={e => onChange(e.target.value)} rows={3} />{help}</label>;
    case 'number':
      return <label>{label}<input type="number" dir="ltr" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'date':
      return <label>{label}<input type="date" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'time':
      return <label>{label}<input type="time" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
    case 'boolean':
      return <label style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} style={{ width: 20, height: 20 }} />{label}</label>;
    case 'select':
      return <label>{label}
        <select value={value ?? ''} onChange={e => onChange(e.target.value)}>
          <option value="">בחרו…</option>
          {(f.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>{help}</label>;
    case 'multiselect':
      return <fieldset style={{ border: 0, padding: 0, margin: 0 }}>{label}
        <div style={{ display: 'grid', gap: 6, marginTop: 6 }}>
          {(f.options || []).map(o => {
            const arr: string[] = Array.isArray(value) ? value : [];
            return <label key={o.value} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={arr.includes(o.value)} style={{ width: 18, height: 18 }}
                onChange={e => onChange(e.target.checked ? [...arr, o.value] : arr.filter(x => x !== o.value))} />
              <span>{o.label}</span></label>;
          })}
        </div>{help}</fieldset>;
    case 'list':
      return <label>{label}<textarea value={Array.isArray(value) ? value.join('\n') : (value ?? '')}
        onChange={e => onChange(e.target.value.split('\n').filter(Boolean))} rows={3} placeholder="פריט אחד בכל שורה" />{help}</label>;
    case 'signature':
      return <div>{label}<SignaturePad value={value} onChange={onChange} />{help}</div>;
    default:
      return <label>{label}<input type="text" value={value ?? ''} onChange={e => onChange(e.target.value)} />{help}</label>;
  }
}

function SignaturePad({ value, onChange }: { value: any; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    ctx.strokeStyle = '#0d1230'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height); img.src = value; }
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => { drawing.current = true; const ctx = ref.current!.getContext('2d')!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (e: React.PointerEvent) => { if (!drawing.current) return; const ctx = ref.current!.getContext('2d')!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current!.toDataURL('image/png')); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); onChange(null); };
  return (
    <div>
      <canvas ref={ref} width={520} height={160} style={{ width: '100%', height: 160, border: '1.5px solid var(--line)', borderRadius: 11, background: '#fff', touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} />
      <button type="button" className="linkish" onClick={clear} style={{ marginTop: 4 }}>ניקוי חתימה</button>
    </div>
  );
}
