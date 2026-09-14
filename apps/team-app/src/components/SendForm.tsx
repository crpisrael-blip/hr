import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { FORM_BASE } from '../lib/config';
import { entityByKey } from '../lib/entities';
import { toUserMessage } from '../lib/errors';
import Dialog from './Dialog';
import { Msg } from './Msg';

// שליחת טופס מתוך כרטיס הישות (מועמד / לקוח / עובד…), בנפרד מבניית הטפסים.
// בונים את הטופס פעם אחת במודול הטפסים; כאן רק שולחים אותו בהקשר הנכון:
// התבניות מסוננות לפי סוג הנמען של הישות, והמופע נקשר אוטומטית לתיק
// (entity_type/entity_id) כך שהוא מופיע חזרה בכרטיס עם מעקב מצב.

interface Tpl { id: string; name: string; recipient_type: string; filing_category: string | null }
interface Recipient { name?: string | null; email?: string | null; phone?: string | null }

export default function SendForm({ entityKey, entityId, recipient, recipientKind, onSent, buttonLabel = '+ שליחת טופס' }:
  { entityKey: string; entityId: string; recipient?: Recipient; recipientKind?: string; onSent?: () => void; buttonLabel?: string }) {
  const { employee } = useAuth();
  const [open, setOpen] = useState(false);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [loadingTpls, setLoadingTpls] = useState(false);
  const [tplId, setTplId] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // סוג הנמען: override מפורש (למשל מועמדות/השמה ששולחות טופס-מועמד אך
  // נקשרות להקשר שלהן), אחרת נגזר מהישות. בלעדיו — רק טפסים כלליים.
  const recKey = recipientKind ?? entityByKey(entityKey)?.recipient;

  useEffect(() => {
    if (!open) return;
    setName(recipient?.name ?? ''); setEmail(recipient?.email ?? ''); setPhone(recipient?.phone ?? '');
    setLink(''); setErr(''); setTplId('');
    setLoadingTpls(true);
    const types = recKey ? [recKey, 'general'] : ['general'];
    supabase.from('form_templates').select('id, name, recipient_type, filing_category')
      .eq('status', 'active').in('recipient_type', types).order('name')
      .then(r => {
        setLoadingTpls(false);
        if (r.error) setErr(toUserMessage(r.error, 'טעינת תבניות הטפסים נכשלה.'));
        else setTpls(r.data as Tpl[]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function create() {
    const tpl = tpls.find(t => t.id === tplId);
    if (!tpl) { setErr('יש לבחור תבנית טופס.'); return; }
    setBusy(true); setErr('');
    // created_by מפורש: מדיניות ה-RLS מתירה יצירה למנהלת או ליוצר עצמו, ואין
    // ברירת מחדל לעמודה — בלי זה מגייס לא יכול לשלוח טופס לתיק שלו.
    const { data, error } = await supabase.from('form_instances').insert({
      template_id: tpl.id, recipient_type: tpl.recipient_type,
      recipient_name: name.trim() || null, recipient_email: email.trim() || null, recipient_phone: phone.trim() || null,
      entity_type: entityKey, entity_id: entityId,
      filing_category: tpl.filing_category ?? null, status: 'created',
      created_by: employee?.id ?? null,
    }).select('token').single();
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'יצירת הטופס נכשלה.')); return; }
    setLink(`${FORM_BASE}/f/${data!.token}`);
    onSent?.();
  }

  const waText = encodeURIComponent(`שלום${name ? ' ' + name : ''}, נא למלא את הטופס: ${link}`);

  return (
    <>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>{buttonLabel}</button>
      <Dialog open={open} title="שליחת טופס" onClose={() => setOpen(false)}
        description="בחר/י תבנית, מלא/י את פרטי הנמען, ותיווצר כתובת ייחודית למילוי — מקושרת אוטומטית לתיק."
        footer={link
          ? <button className="btn btn-primary" onClick={() => setOpen(false)}>סיום</button>
          : <>
              <button className="btn btn-primary" disabled={busy || !tplId} onClick={create}>{busy ? 'יוצר…' : 'יצירת קישור'}</button>
              <button className="btn btn-quiet" onClick={() => setOpen(false)}>ביטול</button>
            </>}>
        {!link ? (
          <div style={{ display: 'grid', gap: 12 }}>
            <label><span className="lbl">תבנית טופס</span>
              <select value={tplId} onChange={e => setTplId(e.target.value)}>
                <option value="">{loadingTpls ? 'טוען…' : '— בחר/י —'}</option>
                {tpls.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            {!loadingTpls && tpls.length === 0 &&
              <p className="hint">אין תבניות פעילות מתאימות. יש לבנות טופס ולסמן אותו כ"פעיל" במודול הטפסים.</p>}
            <label><span className="lbl">שם הנמען</span><input value={name} onChange={e => setName(e.target.value)} /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label><span className="lbl">דוא״ל</span><input type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} /></label>
              <label><span className="lbl">טלפון</span><input dir="ltr" value={phone} onChange={e => setPhone(e.target.value)} /></label>
            </div>
            <Msg kind="err">{err}</Msg>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <label><span className="lbl">קישור למילוי</span>
              <input readOnly value={link} dir="ltr" onFocus={e => e.target.select()} /></label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard?.writeText(link)}>📋 העתקה</button>
              {email && <a className="btn btn-quiet btn-sm" href={`mailto:${email}?subject=${encodeURIComponent('טופס למילוי')}&body=${encodeURIComponent('נא למלא: ' + link)}`}>✉️ מייל</a>}
              {phone && <a className="btn btn-quiet btn-sm" href={`https://wa.me/${phone.replace(/[^\d]/g, '')}?text=${waText}`} target="_blank" rel="noopener">💬 וואטסאפ</a>}
            </div>
            <p className="hint">הקישור נוצר ומקושר לתיק. המצב יתעדכן אוטומטית כשייפתח וימולא.</p>
          </div>
        )}
      </Dialog>
    </>
  );
}
