import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import Recipes, { RecipePage } from './pages/Recipes';
import Week from './pages/Week';
import Groceries from './pages/Groceries';
import Pantry from './pages/Pantry';
import Settings from './pages/Settings';

axios.defaults.withCredentials = true;

const TABS = [
  ['/', 'Recipes', '📖'],
  ['/week', 'Week', '🗓'],
  ['/groceries', 'Groceries', '🛒'],
  ['/pantry', 'Pantry', '🥫'],
];

export default function App() {
  const [auth, setAuth] = useState({ user: undefined, setupRequired: false });
  const check = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/auth/status');
      setAuth({ user: data.user, setupRequired: data.setup_required });
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
  if (!auth.user) return <Login setupRequired={auth.setupRequired} offline={auth.offline} onDone={check} />;
  const logout = async () => { await axios.post('/api/auth/logout').catch(() => {}); check(); };

  return (
    <BrowserRouter>
      <div className="min-h-screen pb-20 sm:pb-6">
        <header className="sticky top-0 z-30 border-b border-life-100 bg-cream/85 backdrop-blur dark:border-life-800 dark:bg-life-900/85">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <NavLink to="/" className="flex items-center gap-2 font-semibold text-life-700 dark:text-life-100">
              <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-lg" /> Life Is
            </NavLink>
            <nav className="ml-4 hidden gap-1 sm:flex" aria-label="Kitchen">
              {TABS.map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `rounded-full px-3 py-1.5 text-sm font-medium ${isActive ? 'bg-life-600 text-white' : 'text-life-700 hover:bg-life-100 dark:text-life-100 dark:hover:bg-life-800'}`}>{label}</NavLink>
              ))}
            </nav>
            <NavLink to="/settings" className="ml-auto text-sm text-life-700 hover:underline dark:text-life-100">Settings</NavLink>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-4">
          <Routes>
            <Route path="/" element={<Recipes />} />
            <Route path="/recipes/:id" element={<RecipePage />} />
            <Route path="/week" element={<Week />} />
            <Route path="/groceries" element={<Groceries />} />
            <Route path="/pantry" element={<Pantry />} />
            <Route path="/settings" element={<Settings user={auth.user} onLogout={logout} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {/* On a phone the kitchen's four parts sit at the bottom, under your thumb. */}
        <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-life-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-life-800 dark:bg-life-900/95 sm:hidden" aria-label="Kitchen">
          {TABS.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex flex-col items-center py-2 text-xs ${isActive ? 'text-life-600 font-semibold dark:text-life-200' : 'text-gray-500 dark:text-life-300'}`}>
              <span aria-hidden="true" className="text-lg">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
      </div>
    </BrowserRouter>
  );
}
