import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/errors';

interface Props { children: ReactNode }
interface State { error: Error | null }

/**
 * גבול שגיאות יחיד לכל האפליקציה. בלעדיו כל זריקה בזמן רנדר
 * (למשל URIError מ-decodeURIComponent על קישור טופס פגום) מסירה את כל העץ
 * ומשאירה מסך לבן.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError('render', { error, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="login-wrap">
        <div className="card login" style={{ textAlign: 'center' }} role="alert">
          <img className="login-logo" src="/ursa-logo.png" alt="URSA GROUP" />
          <h1>משהו השתבש</h1>
          <p className="sub">
            אירעה תקלה בהצגת הדף. אפשר לרענן ולנסות שוב; אם התקלה חוזרת,
            פנו אלינו ונשמח לעזור.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }}
            onClick={() => { window.location.href = '/'; }}>
            חזרה לאזור האישי
          </button>
          <button className="linkish" style={{ marginTop: 10 }}
            onClick={() => window.location.reload()}>רענון הדף</button>
        </div>
      </div>
    );
  }
}
