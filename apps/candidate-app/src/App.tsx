import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Unlinked from './pages/Unlinked';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Documents from './pages/Documents';
import Profile from './pages/Profile';
import FormFill from './pages/FormFill';

export default function App() {
  const { session, link, loading } = useAuth();

  // מילוי טופס חיצוני — ציבורי, לפני שער ההתחברות.
  const formMatch = window.location.pathname.match(/^\/f\/([^/]+)/);
  if (formMatch) return <FormFill token={decodeURIComponent(formMatch[1])} />;

  if (loading || (session && link === 'loading')) {
    return <div className="screen-center"><div className="spinner" /></div>;
  }
  if (!session) return <Login />;
  if (link === 'unlinked') return <Unlinked />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
