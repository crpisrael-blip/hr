import { useCallback, useEffect, useRef, useState } from 'react';
import {
  supabase, DOCS_BUCKET, ALLOWED_UPLOAD_MIME, ALLOWED_UPLOAD_EXT,
  MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, DOCX_MIME,
} from '../lib/supabase';
import { fmtDate, fmtSize, isoAttr } from '../lib/shared';
import { reportError } from '../lib/errors';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

interface Doc {
  id: string; kind: string; file_name: string; storage_path: string;
  size_bytes: number; mime_type: string; version: number; created_at: string;
}
const KIND_LABEL: Record<string, string> = {
  cv: 'קורות חיים', cover_letter: 'מכתב מקדים', certificate: 'תעודה', other: 'מסמך',
};

/**
 * ולידציה מקדימה — לפני ההעלאה ל-Storage.
 * add_my_document דוחה סוג/גודל חורגים, ולמועמד אין מדיניות DELETE בדלי,
 * כך שקובץ שנדחה אחרי ההעלאה נשאר יתום. לכן בודקים כאן קודם.
 * Windows ללא Office מחזיר file.type ריק — נופלים לסיומת.
 */
function checkFile(file: File): { ok: true; mime: string } | { ok: false; msg: string } {
  const name = file.name.toLowerCase();
  const ext = name.slice(name.lastIndexOf('.'));
  const byExt = ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? DOCX_MIME : '';
  const mime = (ALLOWED_UPLOAD_MIME as readonly string[]).includes(file.type) ? file.type : byExt;

  if (!mime) {
    return { ok: false, msg: `אפשר להעלות קבצי ${ALLOWED_UPLOAD_EXT.join(' או ')} בלבד.` };
  }
  if (file.size <= 0) return { ok: false, msg: 'הקובץ ריק.' };
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, msg: `הקובץ גדול מ־${MAX_UPLOAD_MB}MB. נסו לדחוס או להעלות קובץ קטן יותר.` };
  }
  return { ok: true, mime };
}

export default function Documents() {
  useTitle('המסמכים שלי');
  const { candidateId } = useAuth();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [kind, setKind] = useState('cv');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // מזהה המועמד מגיע מ-claim_candidate_profile דרך ה-context — בלי קריאת my_profile נוספת.
  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_documents');
    if (error) {
      setErr(reportError('my_documents', error, 'טעינת המסמכים נכשלה.'));
      setDocs(prev => prev ?? []);
      return;
    }
    setDocs((data ?? []) as Doc[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    setErr(''); setNote('');

    if (!candidateId) {
      setErr('החשבון עדיין לא מקושר לרשומת מועמד, ולכן לא ניתן להעלות מסמכים.');
      return;
    }
    const check = checkFile(file);
    if (!check.ok) { setErr(check.msg); return; }

    setBusy(true);
    const safe = file.name.replace(/[^\w.-]+/g, '_').replace(/\.{2,}/g, '.').slice(-120) || 'file';
    const path = `${candidateId}/${kind}/${Date.now()}-${safe}`;

    const up = await supabase.storage.from(DOCS_BUCKET).upload(path, file, {
      contentType: check.mime, upsert: false,
    });
    if (up.error) {
      setErr(reportError('storage.upload', up.error, 'העלאת הקובץ נכשלה. נסו שוב.'));
      setBusy(false);
      return;
    }

    const { error } = await supabase.rpc('add_my_document', {
      p_kind: kind, p_storage_path: path, p_file_name: file.name,
      p_mime: check.mime, p_size: file.size,
    });
    if (error) {
      setErr(reportError('add_my_document', error, 'רישום המסמך נכשל.'));
      // ניסיון ניקוי. מדיניות candidate_deletes_own נוספה ב-0022, אך אם היא
      // חסרה בסביבה מסוימת הקובץ יישאר בדלי ללא רשומה — ואת זה חייבים
      // לראות בלוג ולא לבלוע (התוצאה של remove נבדקת).
      const rm = await supabase.storage.from(DOCS_BUCKET).remove([path]);
      if (rm.error) {
        reportError('storage.remove (קובץ יתום נשאר בדלי)', { path, error: rm.error }, '');
      }
    } else {
      setNote('המסמך הועלה.');
      await load();
    }
    setBusy(false);
  }

  async function download(d: Doc) {
    setErr('');
    // חלון נפתח סינכרונית — פתיחה אחרי await נחסמת ע"י Safari ב-iOS.
    const w = window.open('', '_blank');
    if (w) w.opener = null;
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).createSignedUrl(d.storage_path, 120);
    if (error || !data?.signedUrl) {
      w?.close();
      setErr(reportError('createSignedUrl', error, 'פתיחת המסמך נכשלה. נסו שוב.'));
      return;
    }
    if (w) w.location.replace(data.signedUrl);
    else window.location.assign(data.signedUrl); // חוסם פופאפים — נופלים לניווט בלשונית הנוכחית
  }

  if (docs === null) return <div className="screen-center"><div className="spinner" role="status" aria-label="טוען" /></div>;

  return (
    <section className="page">
      <h1 className="page-title">המסמכים שלי</h1>

      <div className="card upload">
        <div className="upload-row">
          <label className="sr-only" htmlFor="doc-kind">סוג מסמך</label>
          <select id="doc-kind" value={kind} onChange={e => setKind(e.target.value)}>
            <option value="cv">קורות חיים</option>
            <option value="cover_letter">מכתב מקדים</option>
            <option value="certificate">תעודה</option>
            <option value="other">מסמך אחר</option>
          </select>
          {/* כפתור אמיתי: <label> העוטף input מוסתר אינו נגיש למקלדת (WCAG 2.1.1). */}
          <button type="button" className="btn btn-primary" disabled={busy}
            aria-describedby="upload-hint"
            onClick={() => fileRef.current?.click()}>
            {busy ? 'מעלה…' : 'העלאת קובץ'}
          </button>
          <input ref={fileRef} id="doc-file" type="file" className="sr-only" disabled={busy}
            tabIndex={-1} aria-hidden="true"
            accept={`${ALLOWED_UPLOAD_EXT.join(',')},application/pdf,${DOCX_MIME}`}
            onChange={onFile} />
        </div>
        {err && <p className="msg err" role="alert">{err}</p>}
        {note && <p className="msg ok" role="status" aria-live="polite">{note}</p>}
        <p className="sub" id="upload-hint">קבצי PDF או DOCX עד {MAX_UPLOAD_MB}MB.</p>
      </div>

      {docs.length === 0
        ? <div className="card empty"><p>עדיין לא הועלו מסמכים.</p></div>
        : <ul className="stack doc-list">
            {docs.map(d => (
              <li key={d.id}>
                <button type="button" className="card doc-card" onClick={() => void download(d)}>
                  <span className="doc-ic" aria-hidden="true">📄</span>
                  <span className="doc-main">
                    <bdi className="doc-name">{d.file_name}</bdi>
                    <span className="sub">
                      {KIND_LABEL[d.kind] ?? d.kind} · {fmtSize(d.size_bytes)} ·{' '}
                      <time dateTime={isoAttr(d.created_at)}>{fmtDate(d.created_at)}</time>
                    </span>
                  </span>
                  <span className="sr-only">— פתיחת המסמך</span>
                </button>
              </li>
            ))}
          </ul>}
    </section>
  );
}
