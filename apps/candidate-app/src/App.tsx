import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { envReady } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Unlinked from './pages/Unlinked';

// פיצול קוד: כל דף נטען בנפרד ומקטין את ה-bundle הראשוני.
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Documents = lazy(() => import('./pages/Documents'));
const Profile = lazy(() => import('./pages/Profile'));
const FormFill = lazy(() => import('./pages/FormFill'));

function Spinner() {
  return (
    <div className="screen-center">
      <div className="spinner" role="status" aria-label="טוען" />
    </div>
  );
}

// חסר VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — מסך מוסבר במקום מסך לבן.
function MissingConfig() {
  return (
    <div className="login-wrap">
      <div className="card login" style={{ textAlign: 'center' }} role="alert">
        <h1>תצורה חסרה</h1>
        <p className="sub">
          האזור האישי אינו מוגדר כראוי ולכן אינו יכול להתחבר לשרת.
          הפנייה נרשמה; נסו שוב מאוחר יותר או פנו אלינו.
        </p>
        <p className="hint" dir="ltr">VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY</p>
      </div>
    </div>
  );
}

// האזור האישי עצמו — מאחורי שער ההתחברות.
function Portal() {
  const { session, link, loading } = useAuth();

  if (loading || (session && link === 'loading')) return <Spinner />;
  if (!session) return <Login />;
  if (link === 'unlinked' || link === 'error') return <Unlinked />;

  return (
    <Layout>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Applications />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          <Route path="/documents" element={<Documents />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  if (!envReady) return <MissingConfig />;
  return (
    <Routes>
      {/* מילוי טופס חיצוני — ציבורי, לפני שער ההתחברות. */}
      <Route path="/f/:token" element={<Suspense fallback={<Spinner />}><FormFill /></Suspense>} />
      <Route path="*" element={<Portal />} />
    </Routes>
  );
}
