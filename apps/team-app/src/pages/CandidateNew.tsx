import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg } from '../components/Msg';
import { CustomFieldsEdit } from '../components/CustomFields';

// נרמול טלפון ישראלי לפורמט אחיד, מפתח הכפילות (אפיון, 0.2).
function normalizePhone(raw: string): string | null {
  const d = raw.replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+972')) return '+972' + d.slice(4).replace(/^0/, '');
  if (d.startsWith('972')) return '+972' + d.slice(3).replace(/^0/, '');
  if (d.startsWith('0')) return '+972' + d.slice(1);
  return d;
}

export default function CandidateNew() {
  const nav = useNavigate();
  const { id } = useParams();
  const editing = !!id;
  const [f, setF] = useState({ full_name: '', phone: '', email: '', source: 'ידני', skills: '', desired_salary: '' });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    supabase.from('candidates').select('full_name, phone_raw, email, source, skills, desired_salary, custom').eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) { setErr(toUserMessage(error, 'טעינת המועמד נכשלה.')); return; }
        if (!data) { setErr('המועמד לא נמצא.'); return; }
        setF({
          full_name: data.full_name ?? '', phone: data.phone_raw ?? '', email: data.email ?? '',
          source: data.source ?? '', skills: (data.skills ?? []).join(', '),
          desired_salary: data.desired_salary != null ? String(data.desired_salary) : '',
        });
        setCustom(data.custom ?? {});
      });
    return () => { alive = false; };
  }, [id, editing]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const phone_normalized = normalizePhone(f.phone);
    const body = {
      full_name: f.full_name.trim(),
      phone_raw: f.phone.trim() || null,
      phone_normalized,
      email: f.email.trim() || null,
      source: f.source.trim() || null,
      skills: f.skills ? f.skills.split(',').map(s => s.trim()).filter(Boolean) : null,
      desired_salary: f.desired_salary ? Number(f.desired_salary) : null,
      custom,
    };
    const res = editing
      ? await supabase.from('candidates').update(body).eq('id', id).select('id').single()
      : await supabase.from('candidates').insert(body).select('id').single();
    setBusy(false);
    if (res.error) {
      setErr(res.error.code === '23505' ? 'כבר קיים מועמד עם מספר טלפון זה.' : toUserMessage(res.error, 'שמירת המועמד נכשלה.'));
      return;
    }
    nav(`/candidates/${editing ? id : res.data!.id}`);
  }

  return (
    <>
      <PageHead title={editing ? 'עריכת מועמד' : 'מועמד חדש'} />
      <form className="card" style={{ padding: 24, maxWidth: 560, display: 'grid', gap: 16 }} onSubmit={onSubmit}>
        <label><span className="lbl">שם מלא *</span>
          <input value={f.full_name} onChange={e => set('full_name', e.target.value)} required autoFocus /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label><span className="lbl">טלפון</span>
            <input type="tel" value={f.phone} onChange={e => set('phone', e.target.value)} placeholder="050-0000000" />
            <span className="hint">משמש לזיהוי כפילות.</span></label>
          <label><span className="lbl">דוא״ל</span>
            <input type="email" value={f.email} onChange={e => set('email', e.target.value)} /></label>
        </div>
        <label><span className="lbl">כישורים (מופרדים בפסיק)</span>
          <input value={f.skills} onChange={e => set('skills', e.target.value)} placeholder="Node.js, ניהול צוות" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label><span className="lbl">שכר רצוי</span>
            <input type="number" value={f.desired_salary} onChange={e => set('desired_salary', e.target.value)} /></label>
          <label><span className="lbl">מקור</span>
            <input value={f.source} onChange={e => set('source', e.target.value)} /></label>
        </div>
        <CustomFieldsEdit entityType="candidate" values={custom} onChange={setCustom} />
        <Msg kind="err">{err}</Msg>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => nav('/candidates')}>ביטול</button>
        </div>
      </form>
    </>
  );
}
