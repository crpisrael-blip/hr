import PageHead from '../components/PageHead';
export default function Soon({ title }: { title: string }) {
  return (
    <>
      <PageHead title={title} />
      <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--ink-mid)' }}>
        <p style={{ fontSize: '1.05rem', marginBottom: 6 }}>המודול הזה בבנייה.</p>
        <p className="hint">יתווסף בשלב הבא לפי האפיון.</p>
      </div>
    </>
  );
}
