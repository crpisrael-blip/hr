import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// בועת הרעיונות — לכידה מהירה של רעיונות/באגים/שיפורים/הזדמנויות מכל מסך.
// כלי פיתוח פרטי; נטען רק כשהמשתמש הוא מנהל על (App.tsx). המיקום נשמר
// לכל משתמש ב-localStorage, כך שהבועה חוזרת למקומה אחרי מעבר מסך או כניסה מחדש.

type Kind = 'idea' | 'bug' | 'improvement' | 'opportunity';
interface Idea { id: string; kind: Kind; body: string; context: string | null; status: 'open' | 'done'; created_at: string; }

const KINDS: { k: Kind; label: string; icon: string }[] = [
  { k: 'idea', label: 'רעיון', icon: '💡' },
  { k: 'bug', label: 'באג', icon: '🐞' },
  { k: 'improvement', label: 'שיפור', icon: '✨' },
  { k: 'opportunity', label: 'הזדמנות', icon: '🎯' },
];
const KMAP = Object.fromEntries(KINDS.map(x => [x.k, x]));

// מיפוי נתיב לשם מסך קריא, ללכידת הקשר.
const SCREENS: [RegExp, string][] = [
  [/^\/$/, 'דף הבית'], [/^\/companies/, 'לקוחות'], [/^\/jobs/, 'משרות'],
  [/^\/candidates/, 'מועמדים'], [/^\/applications/, 'תהליכי גיוס'],
  [/^\/tasks/, 'משימות'], [/^\/placements/, 'השמות'],
  [/^\/reports/, 'דוחות'], [/^\/settlements/, 'התחשבנות'],
  [/^\/settings/, 'הגדרות'], [/^\/calendar/, 'לוח שנה'],
];
function screenLabel(path: string) {
  for (const [re, label] of SCREENS) if (re.test(path)) return label;
  return path;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function IdeaBubble() {
  const { session } = useAuth();
  const uid = session?.user.id ?? 'anon';
  const posKey = `ursa.ideabubble.pos.${uid}`;
  const { pathname } = useLocation();

  const [pos, setPos] = useState<{ x: number; y: number }>(() => {
    try { const s = localStorage.getItem(posKey); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return { x: 20, y: Math.max(80, window.innerHeight - 180) };
  });
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>('idea');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [copied, setCopied] = useState(false);

  const drag = useRef<{ dx: number; dy: number; moved: boolean } | null>(null);

  const clamp = (x: number, y: number) => ({
    x: Math.min(Math.max(8, x), window.innerWidth - 60),
    y: Math.min(Math.max(8, y), window.innerHeight - 60),
  });

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const nx = e.clientX - drag.current.dx, ny = e.clientY - drag.current.dy;
    if (Math.abs(e.clientX - (pos.x + drag.current.dx)) > 4 || Math.abs(e.clientY - (pos.y + drag.current.dy)) > 4) drag.current.moved = true;
    setPos(clamp(nx, ny));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const wasDrag = drag.current.moved;
    try { localStorage.setItem(posKey, JSON.stringify(pos)); } catch { /* ignore */ }
    drag.current = null;
    if (!wasDrag) setOpen(o => !o);
  };

  const load = useCallback(async () => {
    const { data } = await supabase.from('dev_ideas')
      .select('id, kind, body, context, status, created_at')
      .order('created_at', { ascending: false }).limit(100);
    if (data) setIdeas(data as Idea[]);
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);

  async function save() {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    const { error } = await supabase.from('dev_ideas')
      .insert({ kind, body: text, context: screenLabel(pathname) });
    setBusy(false);
    if (!error) { setBody(''); load(); }
  }

  async function setStatus(id: string, status: 'open' | 'done') {
    await supabase.from('dev_ideas').update({ status }).eq('id', id);
    setIdeas(list => list.map(i => i.id === id ? { ...i, status } : i));
  }
  async function remove(id: string) {
    await supabase.from('dev_ideas').delete().eq('id', id);
    setIdeas(list => list.filter(i => i.id !== id));
  }

  function copyForLLM() {
    const openItems = ideas.filter(i => i.status === 'open');
    const groups = KINDS.map(({ k, label }) => {
      const rows = openItems.filter(i => i.kind === k);
      if (!rows.length) return '';
      const lines = rows.map((i, n) =>
        `${n + 1}. ${i.body}\n   מסך: ${i.context ?? '—'} · ${fmtDate(i.created_at)}`).join('\n');
      return `## ${label} (${rows.length})\n${lines}`;
    }).filter(Boolean);
    const header = `משוב שנלכד ממערכת URSA GROUP — ${openItems.length} פריטים פתוחים\nנוצר: ${new Date().toLocaleString('he-IL')}`;
    const text = [header, ...groups].join('\n\n');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }

  const openCount = ideas.filter(i => i.status === 'open').length;

  return (
    <div className="ib-root" style={{ left: pos.x, top: pos.y }} dir="rtl">
      {open && (
        <div className="ib-panel" role="dialog" aria-label="בועת הרעיונות">
          <div className="ib-head">
            <strong>לכידת רעיון</strong>
            <button className="ib-x" onClick={() => setOpen(false)} aria-label="סגירה">×</button>
          </div>

          <div className="ib-kinds">
            {KINDS.map(x => (
              <button key={x.k} className={'ib-kind' + (kind === x.k ? ' on' : '')} onClick={() => setKind(x.k)} type="button">
                <span aria-hidden="true">{x.icon}</span>{x.label}
              </button>
            ))}
          </div>

          <textarea className="ib-ta" value={body} onChange={e => setBody(e.target.value)} autoFocus
            placeholder="מה עלה לך? רעיון, באג, שיפור או הזדמנות…"
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
          <div className="ib-actions">
            <span className="ib-hint">Ctrl/⌘ + Enter לשמירה</span>
            <button className="ib-save" onClick={save} disabled={busy || !body.trim()}>{busy ? '…' : 'שמירה'}</button>
          </div>

          <div className="ib-list-head">
            <span>נלכדו ({openCount} פתוחים)</span>
            <button className="ib-copy" onClick={copyForLLM} disabled={!openCount}>
              {copied ? '✓ הועתק' : '📋 העתקה ל-LLM'}
            </button>
          </div>
          <ul className="ib-list">
            {ideas.length === 0 && <li className="ib-empty">עדיין אין לכידות. כל מחשבה — לחיצה אחת.</li>}
            {ideas.map(i => (
              <li key={i.id} className={'ib-item' + (i.status === 'done' ? ' done' : '')}>
                <span className="ib-chip">{KMAP[i.kind].icon} {KMAP[i.kind].label}</span>
                <p className="ib-body">{i.body}</p>
                <div className="ib-meta">
                  <span>{i.context ?? '—'} · {fmtDate(i.created_at)}</span>
                  <span className="ib-row-actions">
                    <button title={i.status === 'open' ? 'סימון כטופל' : 'החזרה לפתוח'}
                      onClick={() => setStatus(i.id, i.status === 'open' ? 'done' : 'open')}>
                      {i.status === 'open' ? '✓' : '↺'}</button>
                    <button title="מחיקה" onClick={() => remove(i.id)}>×</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className={'ib-bubble' + (open ? ' active' : '')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        title="בועת הרעיונות — גררו להזזה, לחיצה ללכידה" aria-label="בועת הרעיונות">
        💡{openCount > 0 && <span className="ib-badge">{openCount}</span>}
      </button>

      <style>{`
        .ib-root { position: fixed; z-index: 9000; }
        .ib-bubble { position: relative; width: 52px; height: 52px; border-radius: 50%; border: 0; cursor: grab;
          background: linear-gradient(135deg, #171763, #080838); color: #fff; font-size: 24px;
          box-shadow: 0 8px 22px #08083855, 0 2px 6px #0000002a; touch-action: none;
          display: grid; place-items: center; transition: transform .15s, box-shadow .15s; }
        .ib-bubble:hover { transform: translateY(-2px) scale(1.05); box-shadow: 0 14px 30px #08083866; }
        .ib-bubble:active { cursor: grabbing; }
        .ib-bubble.active { outline: 3px solid #90c0f8; }
        .ib-badge { position: absolute; top: -3px; inset-inline-end: -3px; min-width: 20px; height: 20px; padding: 0 5px;
          border-radius: 10px; background: #90c0f8; color: #080838; font-size: 12px; font-weight: 700;
          display: grid; place-items: center; box-shadow: 0 2px 6px #0003; }
        .ib-panel { position: absolute; bottom: 62px; inset-inline-start: 0; width: min(340px, calc(100vw - 32px));
          background: #fff; color: #0d1230; border: 1px solid #e7edf8; border-radius: 16px;
          box-shadow: 0 20px 50px #12225026; padding: 14px; font-family: 'Heebo', system-ui, sans-serif;
          display: flex; flex-direction: column; gap: 10px; max-height: min(560px, 80vh); }
        .ib-head { display: flex; justify-content: space-between; align-items: center; }
        .ib-head strong { font-size: 1.02rem; color: #080838; }
        .ib-x { border: 0; background: #f2f4f9; width: 28px; height: 28px; border-radius: 8px; font-size: 18px;
          color: #4a5578; cursor: pointer; line-height: 1; }
        .ib-kinds { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
        .ib-kind { display: flex; align-items: center; gap: 6px; justify-content: center; padding: 8px; border-radius: 10px;
          border: 1.5px solid #e7edf8; background: #f4f8ff; color: #4a5578; font: inherit; font-size: .88rem; cursor: pointer; }
        .ib-kind.on { border-color: #90c0f8; background: #dcebfd; color: #080838; font-weight: 600; }
        .ib-ta { min-height: 78px; resize: vertical; font: inherit; font-size: .95rem; padding: 10px 12px; color: #0d1230;
          border: 1.5px solid #e7edf8; border-radius: 11px; background: #f4f8ff; }
        .ib-ta:focus { outline: none; border-color: #90c0f8; background: #fff; }
        .ib-actions { display: flex; align-items: center; justify-content: space-between; }
        .ib-hint { color: #7d87a6; font-size: .74rem; }
        .ib-save { border: 0; border-radius: 10px; padding: 9px 18px; font: inherit; font-weight: 600; color: #fff; cursor: pointer;
          background: linear-gradient(120deg, #080838, #171763); }
        .ib-save:disabled { opacity: .5; cursor: default; }
        .ib-list-head { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #eef2fa;
          padding-top: 10px; font-size: .82rem; color: #4a5578; }
        .ib-copy { border: 1px solid #90c0f8; background: #dcebfd; color: #080838; border-radius: 9px; padding: 6px 10px;
          font: inherit; font-size: .8rem; font-weight: 600; cursor: pointer; }
        .ib-copy:disabled { opacity: .5; cursor: default; }
        .ib-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
        .ib-empty { color: #7d87a6; font-size: .85rem; text-align: center; padding: 14px 4px; }
        .ib-item { border: 1px solid #eef2fa; border-radius: 11px; padding: 9px 11px; background: #fff; }
        .ib-item.done { opacity: .55; }
        .ib-item.done .ib-body { text-decoration: line-through; }
        .ib-chip { font-size: .72rem; font-weight: 600; color: #171763; background: #eef2fa; border-radius: 999px; padding: 2px 8px; }
        .ib-body { margin: 6px 0 4px; font-size: .9rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
        .ib-meta { display: flex; align-items: center; justify-content: space-between; color: #7d87a6; font-size: .72rem; gap: 8px; }
        .ib-row-actions { display: flex; gap: 4px; }
        .ib-row-actions button { border: 0; background: #f2f4f9; width: 24px; height: 24px; border-radius: 7px; cursor: pointer;
          color: #4a5578; font-size: 14px; line-height: 1; }
        .ib-row-actions button:hover { background: #dcebfd; color: #080838; }
        @media (max-width: 480px) { .ib-panel { width: calc(100vw - 24px); } }
      `}</style>
    </div>
  );
}
