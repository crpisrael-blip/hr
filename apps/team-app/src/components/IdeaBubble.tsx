import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';

// בועת הרעיונות — לכידה מהירה של רעיונות/באגים/שיפורים/הזדמנויות מכל מסך.
// כלי פיתוח פרטי; נטען רק כשהמשתמש הוא מנהל על (App.tsx). המיקום נשמר
// לכל משתמש ב-localStorage, כך שהבועה חוזרת למקומה אחרי מעבר מסך או כניסה מחדש.

type Kind = 'idea' | 'bug' | 'improvement' | 'opportunity';
type Status = 'open' | 'in_progress' | 'done';
interface Idea { id: string; kind: Kind; body: string; context: string | null; status: Status; created_at: string; }

const KINDS: { k: Kind; label: string; icon: string }[] = [
  { k: 'idea', label: 'רעיון', icon: '💡' },
  { k: 'bug', label: 'באג', icon: '🐞' },
  { k: 'improvement', label: 'שיפור', icon: '✨' },
  { k: 'opportunity', label: 'הזדמנות', icon: '🎯' },
];
const KMAP = Object.fromEntries(KINDS.map(x => [x.k, x]));

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
    if (Math.abs(nx - pos.x) > 3 || Math.abs(ny - pos.y) > 3) drag.current.moved = true;
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

  async function setStatus(id: string, status: Status) {
    await supabase.from('dev_ideas').update({ status }).eq('id', id);
    setIdeas(list => list.map(i => i.id === id ? { ...i, status } : i));
  }
  async function remove(id: string) {
    await supabase.from('dev_ideas').delete().eq('id', id);
    setIdeas(list => list.filter(i => i.id !== id));
  }
  const toggle = (i: Idea, s: Status) => setStatus(i.id, i.status === s ? 'open' : s);

  function copyForLLM() {
    const active = ideas.filter(i => i.status !== 'done');
    const groups = KINDS.map(({ k, label }) => {
      const rows = active.filter(i => i.kind === k);
      if (!rows.length) return '';
      const lines = rows.map((i, n) =>
        `${n + 1}. ${i.body}${i.status === 'in_progress' ? ' [בעבודה]' : ''}\n   מסך: ${i.context ?? '—'} · ${fmtDate(i.created_at)}`).join('\n');
      return `## ${label} (${rows.length})\n${lines}`;
    }).filter(Boolean);
    const header = `משוב שנלכד ממערכת URSA GROUP — ${active.length} פריטים פעילים\nנוצר: ${new Date().toLocaleString('he-IL')}`;
    const text = [header, ...groups].join('\n\n');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); });
  }

  const activeCount = ideas.filter(i => i.status !== 'done').length;

  // מיקום חכם: התיבה נפתחת תמיד לתוך המסך, לא נחתכת בקצוות.
  const vw = window.innerWidth, vh = window.innerHeight;
  const PW = Math.min(300, vw - 24);
  const panelLeft = Math.min(Math.max(8, pos.x), vw - PW - 8);
  const openBelow = pos.y < vh / 2;
  const panelPos: React.CSSProperties = openBelow ? { top: pos.y + 60 } : { bottom: vh - pos.y + 8 };

  return (
    <div dir="rtl">
      {open && (
        <div className="ib-panel" role="dialog" aria-label="בועת הרעיונות"
          style={{ position: 'fixed', left: panelLeft, width: PW, ...panelPos }}>
          <div className="ib-head">
            <strong>לכידה מהירה</strong>
            <button className="ib-x" onClick={() => setOpen(false)} aria-label="סגירה" title="סגירה">×</button>
          </div>

          <div className="ib-kinds">
            {KINDS.map(x => (
              <button key={x.k} className={'ib-kind' + (kind === x.k ? ' on' : '')} onClick={() => setKind(x.k)}
                type="button" title={x.label} aria-label={x.label} aria-pressed={kind === x.k}>
                <span aria-hidden="true">{x.icon}</span>
              </button>
            ))}
            <textarea className="ib-ta" value={body} onChange={e => setBody(e.target.value)} autoFocus rows={2}
              placeholder={`${KMAP[kind].label}…`}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
            <button className="ib-icon ib-save" onClick={save} disabled={busy || !body.trim()}
              title="שמירה (Ctrl/⌘+Enter)" aria-label="שמירה">{busy ? '…' : '＋'}</button>
          </div>

          <div className="ib-list-head">
            <span>{activeCount} פעילים</span>
            <button className="ib-icon ib-copy" onClick={copyForLLM} disabled={!activeCount}
              title="העתקה ל-LLM" aria-label="העתקה ל-LLM">{copied ? '✓' : '📋'}</button>
          </div>

          <ul className="ib-list">
            {ideas.length === 0 && <li className="ib-empty">עדיין אין לכידות. כל מחשבה — לחיצה אחת.</li>}
            {ideas.map(i => (
              <li key={i.id} className={'ib-item st-' + i.status}>
                <div className="ib-item-top">
                  <span className="ib-chip" title={KMAP[i.kind].label}>{KMAP[i.kind].icon}</span>
                  <p className="ib-body">{i.body}</p>
                </div>
                <div className="ib-meta">
                  <span className="ib-ctx">{i.context ?? '—'} · {fmtDate(i.created_at)}</span>
                  <span className="ib-row-actions">
                    <button className={i.status === 'in_progress' ? 'on' : ''} title="בעבודה" aria-label="בעבודה"
                      onClick={() => toggle(i, 'in_progress')}>⏳</button>
                    <button className={i.status === 'done' ? 'on' : ''} title="טופל" aria-label="טופל"
                      onClick={() => toggle(i, 'done')}>✓</button>
                    <button title="מחיקה" aria-label="מחיקה" onClick={() => remove(i.id)}>🗑</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className={'ib-bubble' + (open ? ' active' : '')}
        style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 9001 }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        title="בועת הרעיונות — גררו להזזה, לחיצה ללכידה" aria-label="בועת הרעיונות">
        💡{activeCount > 0 && <span className="ib-badge">{activeCount}</span>}
      </button>

      <style>{`
        .ib-bubble { width: 48px; height: 48px; border-radius: 50%; border: 0; cursor: grab;
          background: linear-gradient(135deg, #171763, #080838); color: #fff; font-size: 22px;
          box-shadow: 0 8px 22px #08083855, 0 2px 6px #0000002a; touch-action: none;
          display: grid; place-items: center; transition: transform .15s, box-shadow .15s; }
        .ib-bubble:hover { transform: translateY(-2px) scale(1.05); }
        .ib-bubble:active { cursor: grabbing; }
        .ib-bubble.active { outline: 3px solid #90c0f8; }
        .ib-badge { position: absolute; top: -3px; inset-inline-end: -3px; min-width: 18px; height: 18px; padding: 0 4px;
          border-radius: 9px; background: #90c0f8; color: #080838; font-size: 11px; font-weight: 700;
          display: grid; place-items: center; box-shadow: 0 2px 6px #0003; }

        .ib-panel { z-index: 9002; background: #fff; color: #0d1230; border: 1px solid #e7edf8; border-radius: 14px;
          box-shadow: 0 20px 50px #12225026; padding: 10px; font-family: 'Heebo', system-ui, sans-serif;
          display: flex; flex-direction: column; gap: 8px; max-height: min(72vh, 520px); }
        .ib-head { display: flex; justify-content: space-between; align-items: center; }
        .ib-head strong { font-size: .92rem; color: #080838; }
        .ib-x { border: 0; background: #f2f4f9; width: 24px; height: 24px; border-radius: 7px; font-size: 16px;
          color: #4a5578; cursor: pointer; line-height: 1; }

        /* שורת לכידה קומפקטית: אייקוני סוג + טקסט + שמירה */
        .ib-kinds { display: flex; align-items: stretch; gap: 5px; flex-wrap: wrap; }
        .ib-kind { width: 32px; height: 32px; border-radius: 8px; border: 1.5px solid #e7edf8; background: #f4f8ff;
          font-size: 16px; cursor: pointer; display: grid; place-items: center; padding: 0; flex: 0 0 auto; }
        .ib-kind.on { border-color: #90c0f8; background: #dcebfd; box-shadow: 0 0 0 1px #90c0f8 inset; }
        .ib-ta { flex: 1 1 120px; min-width: 100px; min-height: 32px; resize: vertical; font: inherit; font-size: .9rem;
          padding: 6px 9px; color: #0d1230; border: 1.5px solid #e7edf8; border-radius: 9px; background: #f4f8ff; }
        .ib-ta:focus { outline: none; border-color: #90c0f8; background: #fff; }

        .ib-icon { width: 32px; height: 32px; border-radius: 8px; border: 0; cursor: pointer; font-size: 15px;
          display: grid; place-items: center; flex: 0 0 auto; padding: 0; }
        .ib-save { background: linear-gradient(120deg, #080838, #171763); color: #fff; font-size: 20px; font-weight: 700; }
        .ib-save:disabled { opacity: .45; cursor: default; }
        .ib-copy { border: 1px solid #90c0f8; background: #dcebfd; color: #080838; }
        .ib-copy:disabled { opacity: .45; cursor: default; }

        .ib-list-head { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid #eef2fa;
          padding-top: 8px; font-size: .78rem; color: #4a5578; }

        .ib-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
        .ib-empty { color: #7d87a6; font-size: .82rem; text-align: center; padding: 12px 4px; }
        .ib-item { border: 1px solid #eef2fa; border-radius: 10px; padding: 7px 9px; background: #fff;
          border-inline-start: 3px solid #e7edf8; }
        .ib-item.st-in_progress { border-inline-start-color: #e6a700; background: #fffdf5; }
        .ib-item.st-done { opacity: .5; border-inline-start-color: #0f9d6b; }
        .ib-item.st-done .ib-body { text-decoration: line-through; }
        .ib-item-top { display: flex; gap: 7px; align-items: flex-start; }
        .ib-chip { font-size: 15px; line-height: 1.4; flex: 0 0 auto; }
        .ib-body { margin: 0; font-size: .88rem; line-height: 1.4; white-space: pre-wrap; word-break: break-word; }
        .ib-meta { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 5px; }
        .ib-ctx { color: #7d87a6; font-size: .7rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ib-row-actions { display: flex; gap: 3px; flex: 0 0 auto; }
        .ib-row-actions button { border: 0; background: #f2f4f9; width: 26px; height: 26px; border-radius: 7px; cursor: pointer;
          color: #4a5578; font-size: 13px; line-height: 1; display: grid; place-items: center; padding: 0; }
        .ib-row-actions button:hover { background: #dcebfd; }
        .ib-row-actions button.on { background: #90c0f8; color: #080838; }
      `}</style>
    </div>
  );
}
