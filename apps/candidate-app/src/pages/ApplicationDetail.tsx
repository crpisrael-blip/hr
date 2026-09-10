import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtDate, fmtDateTime } from '../lib/format';

interface Interview {
  scheduled_at: string; location: string | null; status: string; participants: string[] | null;
}
interface AppDetail {
  id: string; job_title: string; exposed: boolean;
  status_label: string; status_explanation: string | null;
  is_closed: boolean; applied_at: string; updated_at: string; interviews: Interview[];
}
interface Msg { id: string; from_me: boolean; body: string; created_at: string; }

export default function ApplicationDetail() {
  const { id } = useParams();
  const [app, setApp] = useState<AppDetail | null | undefined>(undefined);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function loadMsgs() {
    const { data } = await supabase.rpc('my_messages', { p_application_id: id });
    setMsgs((data ?? []) as Msg[]);
  }

  useEffect(() => {
    supabase.rpc('my_application', { p_id: id }).then(({ data }) => setApp((data ?? null) as AppDetail | null));
    loadMsgs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const { error } = await supabase.rpc('send_my_message', { p_application_id: id, p_body: body });
    if (!error) { setText(''); await loadMsgs(); }
    setBusy(false);
  }

  if (app === undefined) return <div className="screen-center"><div className="spinner" /></div>;
  if (app === null) return (
    <section className="page"><p className="msg err">המועמדות לא נמצאה.</p>
      <Link className="linkish" to="/">חזרה למועמדויות</Link></section>
  );

  return (
    <section className="page">
      <Link className="back" to="/">→ המועמדויות שלי</Link>
      <h1 className="page-title">{app.job_title}</h1>

      <div className="card status-card">
        <span className={'chip' + (app.is_closed ? ' chip-mute' : app.exposed ? ' chip-live' : ' chip-soft')}>
          {app.status_label}
        </span>
        {app.status_explanation && <p className="status-exp">{app.status_explanation}</p>}
        <p className="sub">הוגש ב־{fmtDate(app.applied_at)}</p>
      </div>

      {app.interviews.length > 0 && (
        <div className="card">
          <h2 className="card-h">ראיונות</h2>
          {app.interviews.map((iv, i) => (
            <div className="iv" key={i}>
              <div className="iv-when">{fmtDateTime(iv.scheduled_at)}</div>
              {iv.location && <div className="iv-where">📍 {iv.location}</div>}
              {iv.participants && iv.participants.length > 0 &&
                <div className="sub">משתתפים: {iv.participants.join(', ')}</div>}
            </div>
          ))}
        </div>
      )}

      <div className="card chat">
        <h2 className="card-h">שיחה עם המגייס/ת</h2>
        <div className="chat-log">
          {msgs.length === 0 && <p className="sub" style={{ textAlign: 'center' }}>אין הודעות עדיין. אפשר לכתוב לנו כאן.</p>}
          {msgs.map(m => (
            <div key={m.id} className={'bubble' + (m.from_me ? ' me' : ' them')}>
              <p>{m.body}</p>
              <time>{fmtDateTime(m.created_at)}</time>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form className="chat-input" onSubmit={send}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="כתיבת הודעה…" />
          <button className="btn btn-primary" disabled={busy || !text.trim()}>שליחה</button>
        </form>
      </div>
    </section>
  );
}
