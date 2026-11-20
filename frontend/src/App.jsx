import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import Recipes, { RecipePage } from './pages/Recipes';
import Week from './pages/Week';
import Groceries from './pages/Groceries';
import Pantry from './pages/Pantry';
import Settings from './pages/Settings';
import Things, { KindsPage, PlacesPage } from './pages/Things';
import Projects, { ProjectPage } from './pages/Projects';

axios.defaults.withCredentials = true;

// Life is… each section finishes the sentence, and has its own few pages.
const SECTIONS = [
  { word: 'eating', home: '/', owns: (path) => !path.startsWith('/things') && !path.startsWith('/projects') && path !== '/settings',
    tabs: [['/', 'Recipes', '📖'], ['/week', 'Week', '🗓'], ['/groceries', 'Groceries', '🛒'], ['/pantry', 'Pantry', '🥫']] },
  { word: 'keeping', home: '/things', owns: (path) => path.startsWith('/things'),
    tabs: [['/things', 'Things', '📦'], ['/things/places', 'Places', '🗄'], ['/things/kinds', 'Kinds', '🏷']] },
  { word: 'making', home: '/projects', owns: (path) => path.startsWith('/projects'),
    tabs: [['/projects', 'Projects', '🧵']] },
];

export default function App() {
  const [auth, setAuth] = useState({ user: undefined, setupRequired: false });
  const check = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/auth/status');
      setAuth({ user: data.user, setupRequired: data.setup_required, local: data.local });
    } catch {
      setAuth({ user: null, setupRequired: false, offline: true });
    }
  }, []);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    // Any "not logged in" answer (the session ran out) goes back to the login page.
    const id = axios.interceptors.response.use((r) => r, (err) => {
      if (err?.response?.status === 401 && !String(err.config?.url).startsWith('/api/auth/')) setAuth((a) => ({ ...a, user: null }));
      return Promise.reject(err);
    });
    return () => axios.interceptors.response.eject(id);
  }, []);

  if (auth.user === undefined) return null;
  if (!auth.user) return <Login setupRequired={auth.setupRequired} local={auth.local} offline={auth.offline} onDone={check} />;
  const logout = async () => { await axios.post('/api/auth/logout').catch(() => {}); check(); };

  return (
    <BrowserRouter>
      <Shell user={auth.user} onLogout={logout} />
    </BrowserRouter>
  );
}

function Shell({ user, onLogout }) {
  const { pathname } = useLocation();
  const section = SECTIONS.find((s) => s.owns(pathname));
  const tabs = section ? section.tabs : [];
  const exact = (to) => to === '/' || to === '/things' || to === '/projects';
  return (
    <div className="min-h-screen pb-20 sm:pb-6">
      <header className="sticky top-0 z-30 border-b border-life-100 bg-cream/85 backdrop-blur dark:border-life-800 dark:bg-life-900/85">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-life-700 dark:text-life-100">
            <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-lg" /> Life is
          </Link>
          <nav className="flex gap-1" aria-label="Sections">
            {SECTIONS.map((s) => (
              <Link key={s.word} to={s.home} aria-current={s === section ? 'page' : undefined}
                className={`rounded-full px-2.5 py-1 text-sm font-semibold ${s === section ? 'bg-life-600 text-white' : 'text-life-600 hover:bg-life-100 dark:text-life-200 dark:hover:bg-life-800'}`}>{s.word}</Link>
            ))}
          </nav>
          <NavLink to="/settings" aria-label="Settings" className="ml-auto text-sm text-life-700 hover:underline dark:text-life-100"><span className="hidden sm:inline">Settings</span><span aria-hidden="true" className="text-lg sm:hidden">⚙</span></NavLink>
          {tabs.length > 1 && (
            <nav className="hidden w-full gap-1 sm:flex" aria-label={`Life is ${section.word}`}>
              {tabs.map(([to, label]) => (
                <NavLink key={to} to={to} end={exact(to)} className={({ isActive }) => `rounded-full px-3 py-1 text-sm font-medium ${isActive ? 'bg-life-100 text-life-800 dark:bg-life-700 dark:text-white' : 'text-life-700 hover:bg-life-100 dark:text-life-100 dark:hover:bg-life-800'}`}>{label}</NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-4">
        <Routes>
          <Route path="/" element={<Recipes />} />
          <Route path="/recipes/:id" element={<RecipePage />} />
          <Route path="/week" element={<Week />} />
          <Route path="/groceries" element={<Groceries />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/things" element={<Things />} />
          <Route path="/things/kinds" element={<KindsPage />} />
          <Route path="/things/places" element={<PlacesPage />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/settings" element={<Settings user={user} onLogout={onLogout} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {/* On a phone the section's pages sit at the bottom, under your thumb. */}
      {tabs.length > 1 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-life-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-life-800 dark:bg-life-900/95 sm:hidden" aria-label={`Life is ${section.word}`}>
          {tabs.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={exact(to)} className={({ isActive }) => `flex flex-col items-center py-2 text-xs ${isActive ? 'text-life-600 font-semibold dark:text-life-200' : 'text-gray-500 dark:text-life-300'}`}>
              <span aria-hidden="true" className="text-lg">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
