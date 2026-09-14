import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Msg } from './Msg';

// הגדרות ה-AI (ניתוח קורות חיים). קורא/כותב שורות app.settings. עדכון מותר
// למנהלת בלבד (RLS), ומסך ההגדרות ממילא נעול למנהלת. המפתח עצמו לעולם אינו
// נשמר כאן — הוא יושב בסודות ה-Edge Function.

const MODELS: { value: string; label: string }[] = [
  { value: 'claude-sonnet-5', label: 'Sonnet 5 — מומלץ (איזון דיוק/עלות)' },
  { value: 'claude-opus-5', label: 'Opus 5 — דיוק מרבי (יקר יותר)' },
  { value: 'claude-haiku-4-5', label: 'Haiku 4.5 — הזול ביותר' },
];

export default function AiSettings() {
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState('claude-sonnet-5');
  const [quota, setQuota] = useState(0);
  const [used, setUsed] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    // value הוא jsonb — מגיע מ-PostgREST כבר מפוענח (boolean/מחרוזת/מספר).
    const r = await supabase.from('settings').select('key, value')
      .in('key', ['ai.enabled', 'ai.model', 'ai.monthly_quota']);
    if (r.error) { setErr(r.error.message); setLoading(false); return; }
    const map = new Map((r.data as { key: string; value: unknown }[]).map(x => [x.key, x.value]));
    const en = map.get('ai.enabled');
    setEnabled(en === true || en === 'true');
    const md = map.get('ai.model');
    setModel(typeof md === 'string' && md.trim() ? md.trim() : 'claude-sonnet-5');
    setQuota(Math.max(0, Math.floor(Number(map.get('ai.monthly_quota')) || 0)));

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const c = await supabase.from('document_analyses').select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart).in('status', ['done', 'needs_review', 'processing']);
    if (!c.error) setUsed(c.count ?? 0);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  async function save(key: string, value: unknown) {
    setErr(''); setMsg('');
    // value עמודת jsonb — שולחים ערך גולמי (PostgREST צורב אותו כ-jsonb), לא מחרוזת מקודדת.
    const { error } = await supabase.from('settings').update({ value }).eq('key', key);
    if (error) { setErr('שמירה נכשלה: ' + error.message); return; }
    setMsg('נשמר.');
  }

  if (loading) return <div className="card" style={{ padding: 20 }}><p className="spinner">טוען…</p></div>;

  return (
    <div className="card" style={{ padding: 20, maxWidth: 640 }}>
      <h2 className="sec">ניתוח קורות חיים ב-AI</h2>
      <Msg kind="err">{err}</Msg>
      <Msg kind="ok">{msg}</Msg>

      <dl className="dl">
        <dt>מצב</dt>
        <dd>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={enabled} style={{ width: 'auto', minHeight: 0 }}
              onChange={e => { setEnabled(e.target.checked); save('ai.enabled', e.target.checked); }} />
            {enabled ? 'פעיל' : 'כבוי'}
          </label>
        </dd>

        <dt>מודל</dt>
        <dd>
          <select value={model} style={{ minHeight: 34, maxWidth: '100%' }}
            onChange={e => { setModel(e.target.value); save('ai.model', e.target.value); }}>
            {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </dd>

        <dt>מכסה חודשית</dt>
        <dd>
          <input type="number" min={0} defaultValue={quota} style={{ minHeight: 34, width: 120 }}
            onBlur={e => { const n = Math.max(0, Math.floor(Number(e.target.value) || 0)); setQuota(n); save('ai.monthly_quota', n); }} />
          <span className="hint" style={{ marginInlineStart: 8 }}>0 = ללא הגבלה</span>
        </dd>

        <dt>נוצל החודש</dt>
        <dd>{used == null ? '—' : `${used}${quota > 0 ? ` / ${quota}` : ''}`}</dd>
      </dl>

      <p className="hint" style={{ marginTop: 14 }}>
        להפעלה בפועל צריך שמפתח ה-API של Anthropic יהיה מוגדר בסודות ה-Edge Function
        (ANTHROPIC_API_KEY), ושפונקציית analyze-cv תיפרס. המפתח לעולם אינו נשמר כאן ואינו מגיע לדפדפן.
        הניתוח עצמו נעשה מכרטיס המועמד → "ניתוח קורות חיים (AI)".
      </p>
    </div>
  );
}
