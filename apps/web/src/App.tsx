import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from 'react-router';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  ChevronDown,
  GraduationCap,
  Home,
  LayoutGrid,
  LogOut,
  MessageSquareText,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import type { Campaign, Context, Session } from '@coaching/domain';
import {
  ApiError,
  CenterContext,
  request,
  setUnauthorizedHandler,
  useCenter,
  useData,
} from './api';
import { AuthScreen } from './auth-screen';
import { BalanceCard } from './components/BalanceCard';
import { ThemePicker } from './components/ThemePicker';
import { useLocale } from './i18n';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Empty,
  Loading,
  Page,
  State,
  dateTime,
  hasUnsavedChanges,
  allowWorkspaceChange,
} from './ui';

const StudentPages = lazy(() => import('./pages/students'));
const ExamPages = lazy(() => import('./pages/exams'));
const MessagePages = lazy(() => import('./pages/messages'));
const ManagePages = lazy(() => import('./pages/manage'));
const Platform = lazy(() => import('./pages/platform'));
const Security = lazy(() => import('./pages/security'));
const onlineSubscribe = (callback: () => void) => {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
};
const navigation = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/students', label: 'Students', icon: Users, permission: 'students.read' },
  { path: '/exams', label: 'Exams', icon: GraduationCap, permission: 'exams.read' },
  { path: '/messages', label: 'Messages', icon: MessageSquareText, permission: 'messages.read' },
  { path: '/more', label: 'More', icon: MoreHorizontal },
];
function clearSession(client: QueryClient) {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  client.getMutationCache().clear();
  client.setQueryData(['session'], null);
}

export default function App() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, toggle, locale } = useLocale();
  const [accountError, setAccountError] = useState<unknown>();
  const [selected, setSelected] = useState(() => localStorage.getItem('center') ?? '');
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [pendingCenter, setPendingCenter] = useState<string | null>(null);
  const online = useSyncExternalStore(onlineSubscribe, () => navigator.onLine);
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => request<Session | null>('/auth/session', 'GET', undefined, signal),
    refetchOnWindowFocus: (query) => (query.state.data === null ? false : 'always'),
    refetchOnReconnect: (query) => (query.state.data === null ? false : 'always'),
  });
  const centerId =
    session.data?.centers.find((c) => c.id === selected)?.id ?? session.data?.centers[0]?.id;
  const context = useQuery({
    queryKey: ['data', centerId, 'context'],
    queryFn: ({ signal }) =>
      request<Context>(`/c/${centerId ?? ''}/context`, 'GET', undefined, signal),
    enabled: Boolean(centerId),
  });
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession(client);
      void navigate('/');
    });
    return () => setUnauthorizedHandler(null);
  }, [client, navigate]);
  useEffect(() => {
    if (session.error instanceof ApiError && session.error.status === 401) {
      clearSession(client);
    }
  }, [client, session.error]);
  const complete = () => {
    void client.invalidateQueries({ queryKey: ['session'] });
    void navigate('/', { replace: true });
  };
  if (new URLSearchParams(location.search).has('invite')) return <AuthScreen onDone={complete} />;
  if (session.isPending)
    return (
      <main className="standalone">
        <State query={session}>{null}</State>
      </main>
    );
  if (!session.data)
    return session.error instanceof ApiError && session.error.status !== 401 ? (
      <main className="standalone">
        <Alert error={session.error} />
        <Button
          onClick={() => {
            void session.refetch();
          }}
        >
          {t('Try again')}
        </Button>
      </main>
    ) : (
      <AuthScreen onDone={complete} />
    );
  const user = session.data.user;
  const signOut = () => {
    setConfirmSignOut(true);
  };
  const executeSignOut = async () => {
    try {
      await request('/auth/logout', 'POST', {});
    } catch (error) {
      setAccountError(error);
      return;
    }
    allowWorkspaceChange();
    clearSession(client);
    void navigate('/');
  };
  if (
    !centerId ||
    !context.data ||
    (context.error instanceof ApiError && [401, 403, 404].includes(context.error.status))
  )
    return (
      <main className="standalone">
        <header className="page-header">
          <div>
            <p className="eyebrow">COACHING CONNECT</p>
            <h1>
              {t(user.platform ? 'Platform' : 'Welcome back')}, {user.name}
            </h1>
          </div>
          <div className="actions">
            <ThemePicker />
            <Button
              variant="secondary"
              onClick={() => {
                signOut();
              }}
            >
              {t('Sign out')}
            </Button>
          </div>
        </header>
        <Alert error={accountError} />
        {user.platform && !centerId ? (
          <Suspense fallback={<Loading />}>
            <Platform />
          </Suspense>
        ) : centerId ? (
          <State query={context}>{null}</State>
        ) : (
          <Empty
            title="No coaching center available"
            description="Ask your center admin for an invitation or contact the platform owner."
          />
        )}
        <ConfirmDialog
          open={confirmSignOut}
          title="Sign out"
          message={
            hasUnsavedChanges()
              ? 'Sign out and discard unsaved changes?'
              : 'Are you sure you want to sign out?'
          }
          confirmLabel="Sign out"
          danger
          onConfirm={() => {
            setConfirmSignOut(false);
            void executeSignOut();
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
      </main>
    );
  const access = context.data;
  const more = [
    { path: '/groups', label: 'Groups', permission: 'groups.read', icon: Users },
    { path: '/academic', label: 'Subjects', permission: 'academic.read', icon: BookOpen },
    {
      path: '/templates',
      label: 'Templates',
      permission: 'templates.read',
      icon: MessageSquareText,
    },
    ...(access.admin
      ? [{ path: '/staff', label: 'Staff & roles', permission: null, icon: ShieldCheck }]
      : []),
    { path: '/settings', label: 'Settings', permission: 'provider.manage', icon: Settings },
  ];
  return (
    <CenterContext.Provider key={centerId} value={{ ...access, centerId }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link to="/" className="brand">
            <span className="brand-icon">
              <MessageSquareText size={22} />
            </span>
            coaching<span>connect</span>
          </Link>
          <p className="nav-caption">{t('WORKSPACE')}</p>
          <nav aria-label="Main navigation">
            {navigation
              .filter((n) => !n.permission || access.permissions.includes(n.permission))
              .filter((n) => n.path !== '/more')
              .map((n) => (
                <NavLink key={n.path} to={n.path} end={n.path === '/'}>
                  <n.icon size={20} />
                  {t(n.label)}
                </NavLink>
              ))}
          </nav>
          <p className="nav-caption">{t('MANAGE')}</p>
          <nav aria-label="Management">
            {more
              .filter((n) => !n.permission || access.permissions.includes(n.permission))
              .map((n) => (
                <NavLink key={n.path} to={n.path}>
                  <n.icon size={19} />
                  {t(n.label)}
                </NavLink>
              ))}
          </nav>
          <div className="sidebar-bottom">
            <NavLink to="/security">
              <ShieldCheck size={19} />
              {t('Account security')}
            </NavLink>
            {user.platform === 1 && (
              <NavLink to="/platform">
                <LayoutGrid size={19} />
                {t('Platform')}
              </NavLink>
            )}
            <button
              type="button"
              onClick={() => {
                signOut();
              }}
            >
              <LogOut size={19} />
              {t('Sign out')}
            </button>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <label className="center-switch">
              <span className="center-avatar">{access.center.name.slice(0, 1)}</span>
              <select
                aria-label="Coaching center"
                value={pendingCenter ?? centerId}
                onChange={(e) => {
                  setPendingCenter(e.target.value);
                }}
              >
                {session.data.centers.map((center) => (
                  <option key={center.id} value={center.id}>
                    {center.name}
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </label>
            <div className="topbar-right">
              <ThemePicker />
              <Button variant="ghost" onClick={toggle}>
                {locale === 'en' ? 'বাংলা' : 'English'}
              </Button>
              <span className="user-avatar" title={user.name}>
                {user.name.slice(0, 1)}
              </span>
            </div>
          </header>
          {!online && (
            <div className="offline" role="status">
              <WifiOff size={18} />
              {t('You are offline')}
              {t('— reconnect before saving or sending.')}
            </div>
          )}
          <main className="main-content">
            <Alert error={accountError} />
            <Suspense fallback={<Loading />}>
              <Routes
                key={`${location.pathname}${location.pathname === '/messages/new' ? location.search : ''}`}
              >
                <Route element={<Outlet />}>
                  <Route index element={<HomePage name={user.name} />} />
                  <Route path="students/*" element={<StudentPages />} />
                  <Route path="exams/*" element={<ExamPages />} />
                  <Route path="messages/*" element={<MessagePages />} />
                  <Route path="groups/*" element={<ManagePages key="group" section="group" />} />
                  <Route
                    path="academic/*"
                    element={<ManagePages key="academic" section="academic" />}
                  />
                  <Route
                    path="subjects/*"
                    element={<ManagePages key="academic" section="academic" />}
                  />
                  <Route
                    path="templates/*"
                    element={<ManagePages key="templates" section="templates" />}
                  />
                  <Route path="staff/*" element={<ManagePages key="staff" section="staff" />} />
                  <Route
                    path="settings"
                    element={<ManagePages key="settings" section="settings" />}
                  />
                  <Route path="security" element={<Security />} />
                  <Route
                    path="platform"
                    element={user.platform ? <Platform /> : <Navigate to="/" />}
                  />
                  <Route
                    path="more"
                    element={
                      <Page title="More">
                        <div className="menu-list">
                          {more
                            .filter(
                              (n) => !n.permission || access.permissions.includes(n.permission),
                            )
                            .map((n) => (
                              <Link to={n.path} key={n.path}>
                                <n.icon size={22} />
                                {t(n.label)}
                                <ChevronDown size={16} />
                              </Link>
                            ))}
                          <Link to="/security">
                            <ShieldCheck size={22} />
                            {t('Account security')}
                            <ChevronDown size={16} />
                          </Link>
                          <button
                            onClick={() => {
                              signOut();
                            }}
                          >
                            <LogOut size={22} />
                            {t('Sign out')}
                          </button>
                        </div>
                      </Page>
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Empty
                        title="Page not found"
                        description="Choose a page from the navigation to continue."
                      />
                    }
                  />
                </Route>
              </Routes>
            </Suspense>
          </main>
          <footer className="workspace-footer">
            Coaching Connect<span>{t('Made for more meaningful updates.')}</span>
          </footer>
        </div>
        <nav className="bottom-nav" aria-label="Mobile navigation">
          {navigation
            .filter((n) => !n.permission || access.permissions.includes(n.permission))
            .map((n) => (
              <NavLink key={n.path} to={n.path} end={n.path === '/'}>
                <n.icon size={21} />
                <span>{t(n.label)}</span>
              </NavLink>
            ))}
        </nav>
        <ConfirmDialog
          open={confirmSignOut}
          title="Sign out"
          message={
            hasUnsavedChanges()
              ? 'Sign out and discard unsaved changes?'
              : 'Are you sure you want to sign out?'
          }
          confirmLabel="Sign out"
          danger
          onConfirm={() => {
            setConfirmSignOut(false);
            void executeSignOut();
          }}
          onCancel={() => setConfirmSignOut(false)}
        />
        <ConfirmDialog
          open={Boolean(pendingCenter)}
          title="Switch coaching center"
          message={
            pendingCenter
              ? `${t('Switch coaching center to')} "${session.data.centers.find((c) => c.id === pendingCenter)?.name ?? pendingCenter}"?${hasUnsavedChanges() ? ` ${t('Unsaved changes will be discarded.')}` : ''}`
              : 'Switch coaching center?'
          }
          confirmLabel="Switch"
          onConfirm={() => {
            if (pendingCenter) {
              localStorage.setItem('center', pendingCenter);
              allowWorkspaceChange();
              setSelected(pendingCenter);
              void navigate('/');
            }
            setPendingCenter(null);
          }}
          onCancel={() => setPendingCenter(null)}
        />
      </div>
    </CenterContext.Provider>
  );
}

function HomePage({ name }: { name: string }) {
  const { permissions, center } = useCenter();
  const { t, locale } = useLocale();
  const home = useData<{
    students: number | null;
    groups: number | null;
    exams: number | null;
    campaigns: Campaign[];
  }>('/home');
  return (
    <Page eyebrow="Overview" title={`${t('Welcome back')}, ${name.split(' ')[0] ?? name}`}>
      <State query={home}>
        <BalanceCard />
        <div className="stats-grid">
          {[
            { label: 'Students', value: home.data?.students, icon: Users, path: '/students' },
            { label: 'Groups', value: home.data?.groups, icon: LayoutGrid, path: '/groups' },
            { label: 'Exams', value: home.data?.exams, icon: GraduationCap, path: '/exams' },
          ]
            .filter((item) => item.value !== null && item.value !== undefined)
            .map((item) => (
              <Link className="stat" to={item.path} key={item.label}>
                <div className="stat-top">
                  <span>{t(item.label)}</span>
                  <item.icon size={19} />
                </div>
                <strong>{new Intl.NumberFormat(locale).format(item.value ?? 0)}</strong>
                <small>{t('Active in your center')}</small>
              </Link>
            ))}
        </div>
        <section className="panel">
          <div className="section-header">
            <div>
              <h2>{t('Recent messages')}</h2>
              <p className="muted">{t('A clear view of your latest updates.')}</p>
            </div>
            <Link to="/messages">{t('View all')}</Link>
          </div>
          {home.data?.campaigns.length ? (
            <div className="record-list">
              {home.data.campaigns.map((campaign) => (
                <Link className="record-row" key={campaign.id} to={`/messages/${campaign.id}`}>
                  <span className="record-icon">
                    <MessageSquareText size={20} />
                  </span>
                  <div className="grow">
                    <strong>{campaign.name}</strong>
                    <small>
                      {dateTime(campaign.created_at, center.timezone, locale)} · {campaign.total}{' '}
                      {t('messages')}
                    </small>
                  </div>
                  <Badge status={campaign.state} />
                </Link>
              ))}
            </div>
          ) : (
            <Empty
              title="No messages yet"
              description="Your first result update will appear here."
              action={
                permissions.includes('messages.create') ? (
                  <Link className="button secondary" to="/messages/new">
                    {t('New message')}
                  </Link>
                ) : null
              }
            />
          )}
        </section>
      </State>
    </Page>
  );
}
