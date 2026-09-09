import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Companies from './pages/Companies';
import CompanyNew from './pages/CompanyNew';
import Jobs from './pages/Jobs';
import JobNew from './pages/JobNew';
import Candidates from './pages/Candidates';
import CandidateNew from './pages/CandidateNew';
import CandidateDetail from './pages/CandidateDetail';
import Applications from './pages/Applications';
import ApplicationNew from './pages/ApplicationNew';
import ApplicationDetail from './pages/ApplicationDetail';
import Tasks from './pages/Tasks';

export default function App() {
  const { session, employee, loading } = useAuth();

  if (loading) return <div className="spinner">טוען…</div>;
  if (!session) return <Login />;

  // מחובר ל-Auth אך אין רשומת עובד: החשבון לא קושר לצוות.
  if (!employee) {
    return (
      <div className="spinner">
        <p>החשבון מחובר אך אינו משויך לעובד במערכת.</p>
        <p className="hint">מנהל/ת המערכת צריך/ה לקשר אותו דרך <code>app.link_employee</code>.</p>
      </div>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/companies" element={<Companies />} />
        <Route path="/companies/new" element={<CompanyNew />} />
        <Route path="/jobs" element={<Jobs />} />
        <Route path="/jobs/new" element={<JobNew />} />
        <Route path="/candidates" element={<Candidates />} />
        <Route path="/candidates/new" element={<CandidateNew />} />
        <Route path="/candidates/:id" element={<CandidateDetail />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/new" element={<ApplicationNew />} />
        <Route path="/applications/:id" element={<ApplicationDetail />} />
        <Route path="/tasks" element={<Tasks />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
