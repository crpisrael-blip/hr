import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { error: Error | null }

/** גדר שגיאות: חריגת רינדור מציגה מסך בעברית עם רענון, במקום מסך לבן. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[hr] render error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boundary" role="alert" dir="rtl">
        <div className="card boundary-card">
          <h1>משהו השתבש</h1>
          <p>אירעה שגיאה בהצגת המסך. הנתונים במערכת לא נפגעו.</p>
          <p className="hint">אם התקלה חוזרת, צלמו מסך ופנו לצוות הפיתוח.</p>
          <div className="boundary-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>רענון הדף</button>
            <button className="btn btn-quiet" onClick={() => { window.location.href = '/'; }}>חזרה לדף הבית</button>
          </div>
        </div>
        <style>{`
          .boundary { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
          .boundary-card { max-width: 460px; padding: 32px; display: grid; gap: 10px; text-align: start; }
          .boundary-card h1 { font-size: 1.3rem; }
          .boundary-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
        `}</style>
      </div>
    );
  }
}
