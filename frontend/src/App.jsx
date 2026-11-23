import { useCallback, useEffect, useRef, useState } from 'react';
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
import Search from './components/Search';
import HomeReport from './pages/HomeReport';
import WalkThrough from './pages/WalkThrough';
import PetsPage, { PetPage } from './pages/Pets';
import LicensesPage from './pages/Licenses';
import ManualPage from './pages/Manual';
import PackingPage from './pages/Packing';
import UpkeepPage, { JobPage } from './pages/Upkeep';
import ChoreChart from './pages/ChoreChart';
import CollectionPrint from './pages/CollectionPrint';
import { ThingStickersPage, ThingStickerLanding } from './pages/ThingStickers';
import AccessNote from './components/AccessNote';
import Money from './pages/Money';
import DoAction from './pages/DoAction';
import Art, { Stripe } from './components/Art';

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
// `word` is what Life Is calls the section inside; `shown` is the word people see, where that differs.
// In this order: what a household needs first, then what it plans, makes and enjoys.
const SECTIONS = [
  { word: 'eating', shown: 'tasty', home: '/recipes', owns: (path) => ['/week', '/groceries', '/pantry', '/prices'].includes(path) || path.startsWith('/recipes'),
    tabs: [['/recipes', 'Recipes', '📖'], ['/week', 'Week', '🗓'], ['/groceries', 'Groceries', '🛒'], ['/pantry', 'Pantry', '🥫'], ['/prices', 'Prices', '💲']] },
  { word: 'keeping', shown: 'organized', home: '/things', owns: (path) => (path.startsWith('/things') && !path.startsWith('/things/activities')) || ['/manual', '/calendar', '/mail'].some((p) => path.startsWith(p)),
    tabs: [['/calendar', 'Calendar', '📅'], ['/things', 'Things', '📦'], ['/things/places', 'Places', '🗄'], ['/things/upkeep', 'Upkeep', '🔧'], ['/things/licenses', 'Licenses', '🪪'], ['/things/pets', 'Pets', '🐾'], ['/manual', 'House Manual', '📒'], ['/mail', 'Mail', '✉️']] },
  { word: 'spending', shown: 'budgeted', home: '/money', owns: (path) => path.startsWith('/money'), tabs: [['/money', 'This month', '💵']] },
  { word: 'making', shown: 'doing', home: '/projects', owns: (path) => path.startsWith('/projects') || path.startsWith('/plans') || path.startsWith('/things/activities'),
    tabs: [['/projects', 'Projects', '🧵'], ['/plans', 'Plans', '✨'], ['/things/activities', 'Activities', '🛠']] },
  { word: 'enjoying', shown: 'entertaining', home: '/media', owns: (path) => path.startsWith('/media'), tabs: [['/media', 'Collection', '🎞'], ['/media/books', 'Books', '📚'], ['/media/ebooks', 'eBooks', '📱'], ['/media/audiobooks', 'Audiobooks', '🎧'], ['/media/servers', 'Servers', '🖥']] },
];

export default function App() {
  const [auth, setAuth] = useState({ user: undefined, setupRequired: false });
  const check = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/auth/status');
      setAuth({ user: data.user, setupRequired: data.setup_required, local: data.local, demo: data.demo ?? null });
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
  if (!auth.user) return <Login setupRequired={auth.setupRequired} local={auth.local} offline={auth.offline} demo={auth.demo} onDone={check} />;
  const logout = async () => { await axios.post('/api/auth/logout').catch(() => {}); check(); };

  return (
    <BrowserRouter>
      <Shell user={auth.user} demo={Boolean(auth.demo)} onLogout={logout} />
    </BrowserRouter>
  );
}

function Shell({ user, demo = false, onLogout }) {
  const { pathname } = useLocation();
  // What the person asked Life Is to look after decides which sections show. Until they answer, all do.
  const [life, setLife] = useState(null);
  const loadLife = useCallback(() => { axios.get('/api/life').then(({ data }) => setLife(data)).catch(() => {}); }, []);
  useEffect(() => { loadLife(); }, [loadLife]);
  const section = SECTIONS.find((s) => s.owns(pathname));
  const showing = SECTIONS.filter((s) => !life || life.sections.includes(s.word) || (s.word === 'making' && life.sections.includes('planning')) || (s.word === 'keeping' && life.sections.includes('planning')) || s === section);
  // On a phone the words scroll sideways, so bring the current one into view when the page or section changes.
  const navRef = useRef(null);
  const tabsRef = useRef(null);
  useEffect(() => {
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [pathname]);
  const tabs = section ? section.tabs : [];
  const exact = (to) => ['/recipes', '/things', '/projects', '/media', '/calendar', '/plans', '/mail', '/manual'].includes(to);
  return (
    <div className="safe-sides min-h-screen">
      <header className="safe-top sticky top-0 z-30 bg-life-bar text-white shadow-sm print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 xl:max-w-6xl">
          <Link to="/" className="flex items-center gap-2 font-semibold text-white">
            <img src="/mark-192.png" alt="" className="h-9 w-9" /> <span className="font-display text-lg font-bold leading-none">Life is</span> <Art slot="mark" className="-ml-0.5 h-6 w-6" />
          </Link>
          {/* Six words don't fit across a phone. There, Settings stays up beside the name and the words take
              the row below, on one line that scrolls sideways with no visible scrollbar; the current word is
              scrolled into view. From the sm breakpoint up it sits in the row with the name, as before. */}
          <nav ref={navRef} className="order-3 flex w-full min-w-0 flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:order-2 sm:w-auto sm:flex-wrap sm:overflow-visible sm:pr-0 sm:[mask-image:none]" aria-label="Sections">
            {showing.map((s) => (
              <Link key={s.word} to={s.home} aria-current={s === section ? 'page' : undefined}
                className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-sm font-semibold sm:px-2.5 ${s === section ? 'bg-avocado-100 text-avocado-800 shadow-sm' : 'text-white/85 hover:bg-white/15 hover:text-white'}`}>{s.shown ?? s.word}</Link>
            ))}
          </nav>
          <div className="order-2 ml-auto sm:order-3"><Search /></div>
          <NavLink to="/settings" aria-label="Settings" className="order-2 text-sm text-white/90 hover:text-white hover:underline sm:order-3"><span className="hidden sm:inline">Settings</span><span aria-hidden="true" className="text-lg sm:hidden">⚙</span></NavLink>
          {tabs.length > 1 && (
            <nav ref={tabsRef} className="order-4 flex w-full min-w-0 flex-nowrap gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)] sm:flex-wrap sm:overflow-visible sm:pr-0 sm:[mask-image:none]" aria-label={`Life is ${section.shown ?? section.word}`}>
              {tabs.map(([to, label]) => (
                <NavLink key={to} to={to} end={exact(to)} className={({ isActive }) => `flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium sm:min-h-0 ${isActive ? 'bg-white/25 text-white' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>{label}</NavLink>
              ))}
            </nav>
          )}
        </div>
        {/* The bands of a 1970s kitchen (gold, orange, rust, brown), as a stripe under the bar. */}
        <Stripe />
      </header>
      <main className="mx-auto max-w-5xl px-3 py-4 sm:px-4 xl:max-w-6xl">
        {/* The page is a sheet of frosted glass over the cream (or coffee), so everything on it reads clearly. */}
        <div className="rounded-3xl bg-card/70 p-4 shadow-xl shadow-life-800/10 ring-1 ring-life-200/70 backdrop-blur-md dark:bg-life-900/75 dark:shadow-black/30 dark:ring-life-700 sm:p-6">
        {demo && (
          <p className="mb-4 rounded-xl bg-card/90 px-4 py-2.5 text-sm text-gray-700 shadow print:hidden dark:bg-life-800 dark:text-life-100" role="note" data-demo-banner>
            <strong className="text-life-700 dark:text-life-100">Demo.</strong> This household is made up, and everything is reset to the sample data each night. Try anything.
            Things that reach outside (email, look-ups, sharing links) are turned off here. <a href="https://lifeis.living" className="underline">About Life Is</a>
          </p>
        )}
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
          <Route path="/things/places/:id/walk" element={<WalkThrough />} />
          <Route path="/things/activities" element={<Activities />} />
          <Route path="/things/upkeep" element={<UpkeepPage />} />
          <Route path="/things/upkeep/chart" element={<ChoreChart />} />
          <Route path="/things/upkeep/:id" element={<JobPage />} />
          <Route path="/things/stickers" element={<ThingStickersPage />} />
          <Route path="/things/report" element={<HomeReport />} />
          <Route path="/things/packing" element={<PackingPage />} />
          <Route path="/manual" element={<ManualPage />} />
          <Route path="/things/licenses" element={<LicensesPage />} />
          <Route path="/things/pets" element={<PetsPage />} />
          <Route path="/things/pets/:id" element={<PetPage />} />
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
          <Route path="/media/print" element={<CollectionPrint />} />
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
    </div>
  );
}
