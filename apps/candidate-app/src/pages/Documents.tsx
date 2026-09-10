import { useEffect, useRef, useState } from 'react';
import { supabase, DOCS_BUCKET } from '../lib/supabase';
import { fmtDate, fmtSize } from '../lib/format';

interface Doc {
  id: string; kind: string; file_name: string; storage_path: string;
  size_bytes: number; mime_type: string; version: number; created_at: string;
}
const KIND_LABEL: Record<string, string> = {
  cv: 'קורות חיים', cover_letter: 'מכתב מקדים', certificate: 'תעודה', other: 'מסמך',
};

export default function Documents() {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [candidateId, setCandidateId] = useState<string>('');
  const [kind, setKind] = useState('cv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [{ data: prof }, { data: list }] = await Promise.all([
      supabase.rpc('my_profile'),
      supabase.rpc('my_documents'),
    ]);
    setCandidateId(prof?.id ?? '');
    setDocs((list ?? []) as Doc[]);
  }
  useEffect(() => { load(); }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !candidateId) return;
    setErr(''); setBusy(true);
    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${candidateId}/${kind}/${Date.now()}-${safe}`;
    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) { setErr('העלאת הקובץ נכשלה.'); setBusy(false); return; }
    const { error } = await supabase.rpc('add_my_document', {
      p_kind: kind, p_storage_path: path, p_file_name: file.name,
      p_mime: file.type, p_size: file.size,
    });
    if (error) {
      setErr(error.message || 'רישום המסמך נכשל.');
      await supabase.storage.from(DOCS_BUCKET).remove([path]);
    } else {
      await load();
    }
    if (fileRef.current) fileRef.current.value = '';
    setBusy(false);
  }

  async function download(d: Doc) {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(d.storage_path, 120);
    if (!error && data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }

  if (docs === null) return <div className="screen-center"><div className="spinner" /></div>;

  return (
    <section className="page">
      <h1 className="page-title">המסמכים שלי</h1>

      <div className="card upload">
        <div className="upload-row">
          <select value={kind} onChange={e => setKind(e.target.value)} aria-label="סוג מסמך">
            <option value="cv">קורות חיים</option>
            <option value="cover_letter">מכתב מקדים</option>
            <option value="certificate">תעודה</option>
            <option value="other">מסמך אחר</option>
          </select>
          <label className={'btn btn-primary' + (busy ? ' disabled' : '')}>
            {busy ? 'מעלה…' : 'העלאת קובץ'}
            <input ref={fileRef} type="file" hidden disabled={busy}
              accept=".pdf,.doc,.docx,application/pdf" onChange={onFile} />
          </label>
        </div>
        {err && <p className="msg err">{err}</p>}
        <p className="sub">קבצי PDF או Word עד 10MB.</p>
      </div>

      {docs.length === 0
        ? <div className="card empty"><p>עדיין לא הועלו מסמכים.</p></div>
        : <div className="stack">
            {docs.map(d => (
              <button key={d.id} className="card doc-card" onClick={() => download(d)}>
                <div className="doc-ic">📄</div>
                <div className="doc-main">
                  <h2>{d.file_name}</h2>
                  <p className="sub">{KIND_LABEL[d.kind] ?? d.kind} · {fmtSize(d.size_bytes)} · {fmtDate(d.created_at)}</p>
                </div>
              </button>
            ))}
          </div>}
    </section>
  );
}
