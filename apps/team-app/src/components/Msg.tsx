import type { ReactNode } from 'react';

/**
 * הודעת שגיאה/הצלחה עם סמנטיקה נכונה לקוראי מסך.
 * שגיאה = role="alert" (מוקראת מיד); הצלחה/מידע = role="status" (מנומס).
 */
export function Msg({ kind = 'err', children, style }:
  { kind?: 'err' | 'ok'; children: ReactNode; style?: React.CSSProperties }) {
  if (!children) return null;
  return (
    <p className={'msg ' + kind} style={style}
      role={kind === 'err' ? 'alert' : 'status'}
      aria-live={kind === 'err' ? 'assertive' : 'polite'}>
      {children}
    </p>
  );
}

/** מצב טעינה מוכרז. */
export function Loading({ label = 'טוען…', style }: { label?: string; style?: React.CSSProperties }) {
  return <p className="spinner" role="status" aria-live="polite" aria-busy="true" style={style}>{label}</p>;
}

/** מצב ריק אחיד. */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="card empty">{children}</div>;
}
