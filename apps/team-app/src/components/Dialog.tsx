import { useCallback, useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  /** כשמוגדר — התוכן עטוף ב-form והשליחה מפעילה את onSubmit. */
  onSubmit?: () => void;
  wide?: boolean;
}

/**
 * דיאלוג מודאלי נגיש: aria-modal, מלכודת פוקוס, Escape, והחזרת הפוקוס
 * לרכיב שפתח אותו. מחליף prompt()/confirm() בתהליכים עסקיים.
 */
export default function Dialog({ open, title, description, onClose, children, footer, onSubmit, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useRef('dlg-' + Math.random().toString(36).slice(2, 8));

  const focusables = useCallback(() => {
    const root = ref.current;
    if (!root) return [] as HTMLElement[];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.offsetParent !== null);
  }, []);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const first = focusables()[0] ?? ref.current;
    first?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      opener.current?.focus?.();
    };
  }, [open, focusables]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !ref.current?.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  const body = (
    <>
      <h2 id={titleId.current}>{title}</h2>
      {description && <p className="dlg-desc">{description}</p>}
      <div className="dlg-body">{children}</div>
      <div className="dlg-foot">{footer}</div>
    </>
  );

  return (
    <div className="dlg-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'card dlg' + (wide ? ' dlg-wide' : '')} role="dialog" aria-modal="true"
        aria-labelledby={titleId.current} ref={ref} tabIndex={-1} onKeyDown={onKeyDown} dir="rtl">
        <button className="dlg-x" onClick={onClose} aria-label="סגירת החלון">×</button>
        {onSubmit
          ? <form onSubmit={e => { e.preventDefault(); onSubmit(); }}>{body}</form>
          : body}
      </div>
      <style>{`
        .dlg-backdrop { position: fixed; inset: 0; background: rgba(10,20,50,.44); display: grid; place-items: center;
          padding: 16px; z-index: 9500; }
        .dlg { position: relative; width: 100%; max-width: 440px; max-height: 90vh; overflow-y: auto;
          padding: 24px; background: var(--card-solid, #fff); }
        .dlg-wide { max-width: 620px; }
        .dlg h2 { font-size: 1.15rem; margin-bottom: 6px; padding-inline-end: 30px; }
        .dlg-desc { color: var(--ink-mid); font-size: .9rem; margin: 0 0 12px; }
        .dlg-body { display: grid; gap: 12px; }
        .dlg-foot { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
        .dlg-x { position: absolute; inset-inline-end: 12px; inset-block-start: 12px; width: 32px; height: 32px;
          border: 0; border-radius: 8px; background: var(--sunk); color: var(--ink-mid); font-size: 19px;
          line-height: 1; cursor: pointer; }
      `}</style>
    </div>
  );
}
