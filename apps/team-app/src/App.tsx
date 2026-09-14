import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, isManager, isSuperadmin } from './lib/auth';
import { missingConfig } from './lib/supabase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import { Loading, Msg } from './components/Msg';

// פיצול לפי מסלול: המסכים הכבדים (כספים, טפסים, דוחות) לא נטענים בכניסה.
const Companies = lazy(() => import('./pages/Companies'));
const CompanyDetail = lazy(() => import('./pages/CompanyDetail'));
const CompanyNew = lazy(() => import('./pages/CompanyNew'));
const Jobs = lazy(() => import('./pages/Jobs'));
const JobNew = lazy(() => import('./pages/JobNew'));
const JobDetail = lazy(() => import('./pages/JobDetail'));
const Candidates = lazy(() => import('./pages/Candidates'));
const CandidateNew = lazy(() => import('./pages/CandidateNew'));
const CandidateDetail = lazy(() => import('./pages/CandidateDetail'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationNew = lazy(() => import('./pages/ApplicationNew'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const Tasks = lazy(() => import('./pages/Tasks'));
const TaskNew = lazy(() => import('./pages/TaskNew'));
const TaskDetail = lazy(() => import('./pages/TaskDetail'));
const Placements = lazy(() => import('./pages/Placements'));
const PlacementNew = lazy(() => import('./pages/PlacementNew'));
const PlacementDetail = lazy(() => import('./pages/PlacementDetail'));
const Reports = lazy(() => import('./pages/Reports'));
const Settlements = lazy(() => import('./pages/Settlements'));
const Settings = lazy(() => import('./pages/Settings'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Employees = lazy(() => import('./pages/Employees'));
const EmployeeDetail = lazy(() => import('./pages/EmployeeDetail'));
const Forms = lazy(() => import('./pages/Forms'));
const FormBuilder = lazy(() => import('./pages/FormBuilder'));
const FormInstance = lazy(() => import('./pages/FormInstance'));
const IdeaBubble = lazy(() => import('./components/IdeaBubble'));

/** מסך חסימה אחיד: הודעה + פעולות. */
function Gate({ title, children, actions }:
  { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="gate" dir="rtl">
      <div className="card gate-card" role="alert">
        <h1>{title}</h1>
        {children}
        {actions && <div className="gate-actions">{actions}</div>}
      </div>
      <style>{`
        .gate { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
        .gate-card { max-width: 460px; padding: 32px; display: grid; gap: 8px; }
        .gate-card h1 { font-size: 1.25rem; margin-bottom: 4px; }
        .gate-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
      `}</style>
    </div>
  );
}

export default function App() {
  const { session, employee, loading, linkState, linkError, signOut, refreshEmployee } = useAuth();

  if (missingConfig) {
    return (
      <Gate title="תצורה חסרה">
        <p>האפליקציה לא הוגדרה מול מסד הנתונים.</p>
        <p className="hint">יש להגדיר <code dir="ltr">VITE_SUPABASE_URL</code> ו-<code dir="ltr">VITE_SUPABASE_ANON_KEY</code> ולבנות מחדש.</p>
      </Gate>
    );
  }

  if (loading) return <Loading />;
  if (!session) return <Login />;

  if (!employee) {
    const signOutBtn = <button className="btn btn-quiet" onClick={signOut}>יציאה מהחשבון</button>;
    if (linkState === 'error') {
      return (
        <Gate title="לא הצלחנו לטעון את פרטי המשתמש"
          actions={<><button className="btn btn-primary" onClick={refreshEmployee}>ניסיון נוסף</button>{signOutBtn}</>}>
          <Msg kind="err">{linkError || 'טעינת פרטי העובד נכשלה.'}</Msg>
        </Gate>
      );
    }
    if (linkState === 'suspended') {
      return (
        <Gate title="החשבון אינו פעיל" actions={signOutBtn}>
          <p>כרטיס העובד שלכם מסומן כלא פעיל, ולכן אין גישה למערכת.</p>
          <p className="hint">פנו למנהלת המערכת כדי להפעיל אותו מחדש.</p>
        </Gate>
      );
    }
    return (
      <Gate title="החשבון אינו משויך לעובד" actions={signOutBtn}>
        <p>החשבון מחובר אך אינו משויך לכרטיס עובד במערכת.</p>
        <p className="hint">מנהל/ת המערכת צריך/ה לקשר אותו מתוך מסך המגייסים.</p>
      </Gate>
    );
  }

  const mgr = isManager(employee);

  return (
    <Layout>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/companies" element={<Companies />} />
          <Route path="/companies/new" element={<CompanyNew />} />
          <Route path="/companies/:id" element={<CompanyDetail />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/new" element={<JobNew />} />
          <Route path="/jobs/:id/edit" element={<JobNew />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/candidates/new" element={<CandidateNew />} />
          <Route path="/candidates/:id/edit" element={<CandidateNew />} />
          <Route path="/candidates/:id" element={<CandidateDetail />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/applications/new" element={<ApplicationNew />} />
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/tasks/new" element={<TaskNew />} />
          <Route path="/tasks/:id" element={<TaskDetail />} />
          <Route path="/placements" element={<Placements />} />
          <Route path="/placements/new" element={<PlacementNew />} />
          <Route path="/placements/:id" element={<PlacementDetail />} />
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/new" element={<FormBuilder />} />
          <Route path="/forms/instances/:id" element={<FormInstance />} />
          <Route path="/forms/:id" element={<FormBuilder />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/calendar" element={<Calendar />} />
          {/* מסכי מנהלת בלבד: ללא הרשאה מפנים לדף הבית במקום להציג מסך שגיאה. */}
          <Route path="/employees" element={mgr ? <Employees /> : <Navigate to="/" replace />} />
          <Route path="/employees/:id" element={mgr ? <EmployeeDetail /> : <Navigate to="/" replace />} />
          <Route path="/finance" element={mgr ? <Settlements /> : <Navigate to="/" replace />} />
          <Route path="/settlements" element={<Navigate to="/finance" replace />} />
          <Route path="/settings" element={mgr ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {isSuperadmin(employee) && <IdeaBubble />}
      </Suspense>
    </Layout>
  );
}
