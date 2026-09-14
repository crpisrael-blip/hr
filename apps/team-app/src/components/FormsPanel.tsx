import { Link } from 'react-router-dom';
import { FORM_STATUS, formatDate, label } from '../lib/format';
import SendForm from './SendForm';

// קטע "טפסים" אחיד לכרטיסי הישויות: כותרת + כפתור שליחה בהקשר, ורשימת
// המופעים שנשלחו עם מעקב מצב. מקור אמת יחיד לעיצוב ולניווט לכל הכרטיסים.

export interface FormInst {
  id: string; status: string; sent_at: string | null; completed_at: string | null;
  created_at: string; form_templates: { name: string } | null;
}

export default function FormsPanel({ entityKey, entityId, recipient, recipientKind, rows, onSent, emptyText = 'לא נשלחו טפסים.' }: {
  entityKey: string; entityId: string;
  recipient?: { name?: string | null; email?: string | null; phone?: string | null };
  recipientKind?: string; rows: FormInst[]; onSent: () => void; emptyText?: string;
}) {
  return (
    <div className="card" style={{ padding: 20 }}>
      <div className="spread" style={{ alignItems: 'center', marginBottom: 8 }}>
        <h2 className="sec" style={{ margin: 0 }}>טפסים ({rows.length})</h2>
        <SendForm entityKey={entityKey} entityId={entityId} recipient={recipient} recipientKind={recipientKind} onSent={onSent} />
      </div>
      {rows.length === 0 ? <p className="hint">{emptyText}</p> : (
        <ul className="linklist">
          {rows.map(f => (
            <li key={f.id}>
              <Link to={`/forms/instances/${f.id}`}>
                <span>{f.form_templates?.name ?? 'טופס'}
                  <span className="hint" style={{ display: 'block' }}>
                    {f.status === 'completed' && f.completed_at ? 'הושלם ' + formatDate(f.completed_at)
                      : f.sent_at ? 'נשלח ' + formatDate(f.sent_at)
                      : 'נוצר ' + formatDate(f.created_at)}
                  </span>
                </span>
                <span className={'tag ' + (f.status === 'completed' ? 'ok' : 'brand')}>{label(FORM_STATUS, f.status)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
