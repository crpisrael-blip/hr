import { type ReactNode } from 'react';
export default function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 22 }}>
      <div>
        <h1 style={{ fontSize: '1.5rem' }}>{title}</h1>
        {sub && <p style={{ color: 'var(--ink-mid)', marginTop: 4 }}>{sub}</p>}
      </div>
      {action}
    </header>
  );
}
