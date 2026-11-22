import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import Login from './pages/Login';
import Home from './pages/Home';
import Recipes, { RecipePage } from './pages/Recipes';
import Week from './pages/Week';
import Groceries from './pages/Groceries';
import Pantry from './pages/Pantry';
import Settings from './pages/Settings';
import Things, { KindsPage, PlacesPage } from './pages/Things';
import Projects, { ProjectPage } from './pages/Projects';
import { LifeFirstRun } from './components/LifeAreas';
import Calendar from './pages/Calendar';
import MediaPage, { MediaTitlePage } from './pages/Media';
import Servers from './pages/Servers';
import Mail from './pages/Mail';
import Prices from './pages/Prices';
import PlansPage, { PlanPage } from './pages/Plans';
import { PlacePage, StickerLanding, StickersPage } from './pages/Places';
import FillPlace from './pages/FillPlace';
import Thing from './pages/Thing';
import Activities from './pages/Activities';
import { ThingStickersPage, ThingStickerLanding } from './pages/ThingStickers';
import AccessNote from './components/AccessNote';
import Money from './pages/Money';
import DoAction from './pages/DoAction';

axios.defaults.withCredentials = true;
// The server keeps time in UTC, so each request says what day it is here. Without it, something finished at
// nine in the evening would be dated tomorrow.
axios.interceptors.request.use((config) => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  config.headers['X-Local-Day'] = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return config;
});

// Life is… each section finishes the sentence, and has its own few pages.
const SECTIONS = [
  { word: 'eating', home: '/recipes', owns: (path) => ['/week', '/groceries', '/pantry', '/prices'].includes(path) || path.startsWith('/recipes'),
    tabs: [['/recipes', 'Recipes', '📖'], ['/week', 'Week', '🗓'], ['/groceries', 'Groceries', '🛒'], ['/pantry', 'Pantry', '🥫'], ['/prices', 'Prices', '💲']] },
  { word: 'planning', home: '/calendar', owns: (path) => path.startsWith('/calendar') || path.startsWith('/plans') || path.startsWith('/mail'), tabs: [['/calendar', 'Calendar', '📅'], ['/plans', 'Plans', '✨'], ['/mail', 'Mail', '✉️']] },
  { word: 'keeping', home: '/things', owns: (path) => path.startsWith('/things'),
    tabs: [['/things', 'Things', '📦'], ['/things/places', 'Places', '🗄'], ['/things/activities', 'Activities', '🛠'], ['/things/kinds', 'Kinds', '🏷']] },
  { word: 'making', home: '/projects', owns: (path) => path.startsWith('/projects'),
    tabs: [['/projects', 'Projects', '🧵']] },
  { word: 'spending', home: '/money', owns: (path) => path.startsWith('/money'), tabs: [['/money', 'This month', '💵']] },
  { word: 'enjoying', home: '/media', owns: (path) => path.startsWith('/media'), tabs: [['/media', 'Collection', '🎞'], ['/media/books', 'Books', '📚'], ['/media/ebooks', 'Ebooks', '📱'], ['/media/audiobooks', 'Audiobooks', '🎧'], ['/media/servers', 'Servers', '🖥']] },
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
  // What the person asked Life Is to look after decides which sections show. Until they answer, all do.
  const [life, setLife] = useState(null);
  const loadLife = useCallback(() => { axios.get('/api/life').then(({ data }) => setLife(data)).catch(() => {}); }, []);
  useEffect(() => { loadLife(); }, [loadLife]);
  const section = SECTIONS.find((s) => s.owns(pathname));
  const showing = SECTIONS.filter((s) => !life || life.sections.includes(s.word) || s === section);
  const tabs = section ? section.tabs : [];
  const exact = (to) => ['/recipes', '/things', '/projects', '/media'].includes(to);
  return (
    <div className="safe-sides safe-bottom-room min-h-screen">
      <header className="safe-top sticky top-0 z-30 bg-life-bar text-white shadow-sm print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 xl:max-w-6xl">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <img src="/icon-192.png" alt="" className="h-7 w-7 rounded-lg" /> Life is
          </Link>
          {/* Six words don't fit across a phone. There, Settings stays up beside the name and the words take
              the row below, wrapping rather than running off the edge; on a wider screen it is all one row. */}
          <nav className="order-3 flex w-full min-w-0 flex-wrap gap-1 sm:order-2 sm:w-auto" aria-label="Sections">
            {showing.map((s) => (
              <Link key={s.word} to={s.home} aria-current={s === section ? 'page' : undefined}
                className={`rounded-full px-2 py-1 text-sm font-semibold sm:px-2.5 ${s === section ? 'bg-white text-life-800 shadow-sm' : 'text-white/85 hover:bg-white/15 hover:text-white'}`}>{s.word}</Link>
            ))}
          </nav>
          <NavLink to="/settings" aria-label="Settings" className="order-2 ml-auto text-sm text-white/90 hover:text-white hover:underline sm:order-3"><span className="hidden sm:inline">Settings</span><span aria-hidden="true" className="text-lg sm:hidden">⚙</span></NavLink>
          {tabs.length > 1 && (
            <nav className="order-4 hidden w-full gap-1 sm:flex" aria-label={`Life is ${section.word}`}>
              {tabs.map(([to, label]) => (
                <NavLink key={to} to={to} end={exact(to)} className={({ isActive }) => `rounded-full px-3 py-1 text-sm font-medium ${isActive ? 'bg-white/25 text-white' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>{label}</NavLink>
              ))}
            </nav>
          )}
        </div>
        {/* All five colours, as a stripe under the bar. */}
        <div aria-hidden="true" className="h-1 bg-life-all" />
      </header>
      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 xl:max-w-6xl">
        {/* The page is a sheet of frosted glass over the gradient, so everything on it reads clearly. */}
        <div className="rounded-3xl bg-white/80 p-4 shadow-xl ring-1 ring-white/50 backdrop-blur-md dark:bg-life-900/75 dark:ring-white/10 sm:p-6">
        <AccessNote show={Boolean(section) && section.word !== 'eating' && pathname !== '/' && !pathname.startsWith('/settings')} pathname={pathname} />
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/recipes" element={<Recipes />} />
          <Route path="/recipes/:id" element={<RecipePage />} />
          <Route path="/week" element={<Week />} />
          <Route path="/groceries" element={<Groceries />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/prices" element={<Prices />} />
          <Route path="/things" element={<Things />} />
          <Route path="/things/kinds" element={<KindsPage />} />
          <Route path="/things/places" element={<PlacesPage />} />
          <Route path="/things/places/stickers" element={<StickersPage />} />
          <Route path="/things/places/:id" element={<PlacePage />} />
          <Route path="/things/places/:id/fill" element={<FillPlace />} />
          <Route path="/things/activities" element={<Activities />} />
          <Route path="/things/stickers" element={<ThingStickersPage />} />
          <Route path="/things/:id" element={<Thing />} />
          <Route path="/t/:code" element={<ThingStickerLanding />} />
          <Route path="/p/:code" element={<StickerLanding />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/mail" element={<Mail />} />
          <Route path="/plans" element={<PlansPage />} />
          <Route path="/plans/:id" element={<PlanPage />} />
          <Route path="/media" element={<MediaPage key="all" />} />
          <Route path="/media/books" element={<MediaPage key="books" library="books" />} />
          <Route path="/media/ebooks" element={<MediaPage key="ebooks" library="ebooks" />} />
          <Route path="/media/audiobooks" element={<MediaPage key="audiobooks" library="audiobooks" />} />
          <Route path="/media/servers" element={<Servers />} />
          <Route path="/media/:id" element={<MediaTitlePage />} />
          <Route path="/money" element={<Money />} />
          <Route path="/do/:id" element={<DoAction />} />
          <Route path="/settings" element={<Settings user={user} onLogout={onLogout} onLifeChanged={setLife} />} />
          <Route path="/settings/:group" element={<Settings user={user} onLogout={onLogout} onLifeChanged={setLife} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </div>
      </main>
      <LifeFirstRun open={!!life && life.areas === null} onDone={(data) => (data ? setLife(data) : loadLife())} />
      {/* On a phone the section's pages sit at the bottom, under your thumb. */}
      {tabs.length > 1 && (
        <nav className="fixed inset-x-0 bottom-0 z-30 grid auto-cols-fr grid-flow-col border-t border-life-100 bg-white/95 safe-bottom backdrop-blur dark:border-life-800 dark:bg-life-900/95 sm:hidden" aria-label={`Life is ${section.word}`}>
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
