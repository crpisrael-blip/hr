import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDate, fmtDateTime, isoAttr } from '../lib/shared';
import { reportError } from '../lib/errors';
import { useTitle } from '../lib/useTitle';

interface Interview {
  scheduled_at: string; location: string | null; status: string; participants: string[] | null;
}
interface AppDetail {
  id: string; job_title: string; exposed: boolean;
  status_label: string; status_explanation: string | null;
  is_closed: boolean; applied_at: string; updated_at: string; interviews: Interview[];
}
interface Msg { id: string; from_me: boolean; body: string; created_at: string; }

// כל כמה זמן נמשכות הודעות חדשות. בלי זה תשובת המגייס/ת מופיעה רק אחרי רענון.
const POLL_MS = 20000;
// תואם ל-send_my_message (supabase/migrations/0023_business_rules_fixes.sql:810).
const MAX_BODY = 4000;

export default function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<AppDetail | null | undefined>(undefined);
  const [loadErr, setLoadErr] = useState('');
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [msgsErr, setMsgsErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useTitle(app ? app.job_title : 'מועמדות');

  const loadApp = useCallback(async () => {
    if (!id) return;
    setLoadErr('');
    const { data, error } = await supabase.rpc('my_application', { p_id: id });
    if (error) {
      // שגיאת רשת או UUID פגום — לא "לא נמצאה".
      setLoadErr(reportError('my_application', error, 'טעינת המועמדות נכשלה.'));
      setApp(null);
      return;
    }
    setApp((data ?? null) as AppDetail | null);
  }, [id]);

  const loadMsgs = useCallback(async (quiet = false) => {
    if (!id) return;
    const { data, error } = await supabase.rpc('my_messages', { p_application_id: id });
    if (error) {
      // חשוב: כשל טעינה אינו "אין הודעות עדיין".
      const m = reportError('my_messages', error, 'טעינת ההודעות נכשלה.');
      if (!quiet) setMsgsErr(m);
      return;
    }
    setMsgsErr('');
    setMsgs((data ?? []) as Msg[]);
  }, [id]);

  useEffect(() => {
    setApp(undefined); setMsgs(null);
    void loadApp();
    void loadMsgs();
  }, [loadApp, loadMsgs]);

  // רענון תקופתי — רק כשהלשונית גלויה, ורענון מיידי בחזרה אליה.
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') void loadMsgs(true); };
    const t = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [loadMsgs]);

  // גלילה בתוך תיבת השיחה בלבד — לא גלילה של כל החלון, שמדלגת על הסטטוס והראיונות.
  useEffect(() => {
    const el = logRef.current;
    if (!el || msgs === null) return;
    el.scrollTop = el.scrollHeight;
  }, [msgs]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !id) return;
    if (body.length > MAX_BODY) { setSendErr(`ההודעה ארוכה מדי (עד ${MAX_BODY} תווים).`); return; }
    setBusy(true); setSendErr('');
    const { error } = await supabase.rpc('send_my_message', { p_application_id: id, p_body: body });
    setBusy(false);
    if (error) {
      // ההודעה נשארת בתיבה כדי שלא תאבד; ההסבר מוצג (למשל "השיחה מושבתת").
      setSendErr(reportError('send_my_message', error, 'שליחת ההודעה נכשלה. נסו שוב.'));
      return;
    }
    setText('');
    await loadMsgs();
  }

  if (app === undefined) return <div className="screen-center"><div className="spinner" role="status" aria-label="טוען" /></div>;

  if (app === null) return (
    <section className="page">
      <p className="msg err" role="alert">{loadErr || 'המועמדות לא נמצאה.'}</p>
      {loadErr && <button type="button" className="linkish" onClick={() => { setApp(undefined); void loadApp(); }}>נסו שוב</button>}
      <Link className="linkish" to="/">חזרה למועמדויות</Link>
    </section>
  );

  return (
    <section className="page">
      <Link className="back" to="/"><span aria-hidden="true">→ </span>המועמדויות שלי</Link>
      <h1 className="page-title">{app.job_title}</h1>

      <div className="card status-card">
        <span className={'chip' + (app.is_closed ? ' chip-mute' : app.exposed ? ' chip-live' : ' chip-soft')}>
          {app.status_label}
        </span>
        {app.status_explanation && <p className="status-exp">{app.status_explanation}</p>}
        <p className="sub">הוגש ב־<time dateTime={isoAttr(app.applied_at)}>{fmtDate(app.applied_at)}</time></p>
      </div>

      {app.interviews.length > 0 && (
        <div className="card">
          <h2 className="card-h">ראיונות</h2>
          {app.interviews.map((iv, i) => (
            <div className="iv" key={i}>
              <div className="iv-when">
                <time dateTime={isoAttr(iv.scheduled_at)}>{fmtDateTime(iv.scheduled_at)}</time>
              </div>
              {iv.location && <div className="iv-where"><span aria-hidden="true">📍 </span>{iv.location}</div>}
              {iv.participants && iv.participants.length > 0 &&
                <div className="sub">משתתפים: {iv.participants.join(', ')}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card chat">
        <h2 className="card-h" id="chat-h">שיחה עם המגייס/ת</h2>

        <div className="chat-log" ref={logRef} role="log" aria-live="polite" aria-labelledby="chat-h" tabIndex={0}>
          {msgs === null && <p className="sub" style={{ textAlign: 'center' }}>טוען הודעות…</p>}
          {msgs !== null && msgs.length === 0 && !msgsErr &&
            <p className="sub" style={{ textAlign: 'center' }}>אין הודעות עדיין. אפשר לכתוב לנו כאן.</p>}
          {(msgs ?? []).map(m => (
            <div key={m.id} className={'bubble' + (m.from_me ? ' me' : ' them')}>
              <p>{m.body}</p>
              <time dateTime={isoAttr(m.created_at)}>{fmtDateTime(m.created_at)}</time>
            </div>
          ))}
        </div>

        {msgsErr && (
          <p className="msg err" role="alert">
            {msgsErr}{' '}
            <button type="button" className="linkish" onClick={() => void loadMsgs()}>נסו שוב</button>
          </p>
        )}

        <form className="chat-input" onSubmit={send}>
          <label className="sr-only" htmlFor="chat-body">כתיבת הודעה למגייס/ת</label>
          <input id="chat-body" value={text} maxLength={MAX_BODY}
            onChange={e => { setText(e.target.value); setSendErr(''); }}
            aria-invalid={sendErr ? true : undefined}
            aria-describedby={sendErr ? 'chat-err' : undefined}
            placeholder="כתיבת הודעה…" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>
            {busy ? 'שולח…' : 'שליחה'}
          </button>
        </form>
        {sendErr && <p className="msg err" id="chat-err" role="alert">{sendErr}</p>}
      </div>
    </section>
  );
}
