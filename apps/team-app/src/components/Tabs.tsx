import { useRef } from 'react';

export interface TabDef<K extends string = string> { key: K; label: string; disabled?: boolean; title?: string }

/**
 * רצועת טאבים נגישה: role="tablist"/"tab" עם aria-selected, ניווט בחיצים
 * (SC 2.1.1 + דפוס ה-Tabs של WAI-ARIA). התוכן שמתחת חייב לשאת
 * role="tabpanel" ו-aria-labelledby עם המזהה שמוחזר מ-tabId.
 */
export function tabId(group: string, key: string) { return `${group}-tab-${key}`; }
export function panelId(group: string, key: string) { return `${group}-panel-${key}`; }

export default function Tabs<K extends string>({ group, tabs, value, onChange, className = 'tabs', label }:
  { group: string; tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; className?: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const usable = tabs.filter(t => !t.disabled);
    const i = usable.findIndex(t => t.key === value);
    if (i < 0) return;
    let next = -1;
    // ב-RTL חץ שמאל מתקדם וחץ ימין חוזר.
    if (e.key === 'ArrowLeft') next = (i + 1) % usable.length;
    else if (e.key === 'ArrowRight') next = (i - 1 + usable.length) % usable.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = usable.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(usable[next].key);
    ref.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(group, usable[next].key))}`)?.focus();
  }

  return (
    <div className={className} role="tablist" aria-label={label} ref={ref} onKeyDown={onKeyDown}>
      {tabs.map(t => (
        <button key={t.key} id={tabId(group, t.key)} role="tab" type="button"
          aria-selected={t.key === value} aria-controls={panelId(group, t.key)}
          tabIndex={t.key === value ? 0 : -1} disabled={t.disabled} title={t.title}
          className={(t.key === value ? 'on' : '') + (t.disabled ? ' soon' : '')}
          onClick={() => !t.disabled && onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** עטיפת תוכן טאב עם הסמנטיקה המתאימה. */
export function TabPanel({ group, tabKey, children }: { group: string; tabKey: string; children: React.ReactNode }) {
  return <div role="tabpanel" id={panelId(group, tabKey)} aria-labelledby={tabId(group, tabKey)} tabIndex={0}>{children}</div>;
}
