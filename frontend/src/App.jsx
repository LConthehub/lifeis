import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Icon from './components/Icon';
import axios from 'axios';
import Login from './pages/Login';
import Home from './pages/Home';
const Recipes = lazyPage(() => import('./pages/Recipes'));
const RecipePage = lazyPage(() => import('./pages/Recipes').then((m) => ({ default: m.RecipePage })));
const Week = lazyPage(() => import('./pages/Week'));
const Groceries = lazyPage(() => import('./pages/Groceries'));
const Pantry = lazyPage(() => import('./pages/Pantry'));
const Settings = lazyPage(() => import('./pages/Settings'));
const Things = lazyPage(() => import('./pages/Things'));
const KindsPage = lazyPage(() => import('./pages/Things').then((m) => ({ default: m.KindsPage })));
const PlacesPage = lazyPage(() => import('./pages/Things').then((m) => ({ default: m.PlacesPage })));
const Projects = lazyPage(() => import('./pages/Projects'));
const ProjectPage = lazyPage(() => import('./pages/Projects').then((m) => ({ default: m.ProjectPage })));
const Calendar = lazyPage(() => import('./pages/Calendar'));
const MediaPage = lazyPage(() => import('./pages/Media'));
const MediaTitlePage = lazyPage(() => import('./pages/Media').then((m) => ({ default: m.MediaTitlePage })));
const Servers = lazyPage(() => import('./pages/Servers'));
const ListsPage = lazyPage(() => import('./pages/Lists'));
const ListPage = lazyPage(() => import('./pages/Lists').then((m) => ({ default: m.ListPage })));
const Mail = lazyPage(() => import('./pages/Mail'));
const Prices = lazyPage(() => import('./pages/Prices'));
const PlansPage = lazyPage(() => import('./pages/Plans'));
const PlanPage = lazyPage(() => import('./pages/Plans').then((m) => ({ default: m.PlanPage })));
const HolidaysPage = lazyPage(() => import('./pages/Holidays'));
const HolidayPage = lazyPage(() => import('./pages/Holidays').then((m) => ({ default: m.HolidayPage })));
const TripsPage = lazyPage(() => import('./pages/Trips'));
const TripPage = lazyPage(() => import('./pages/Trips').then((m) => ({ default: m.TripPage })));
const PlacePage = lazyPage(() => import('./pages/Places').then((m) => ({ default: m.PlacePage })));
const StickerLanding = lazyPage(() => import('./pages/Places').then((m) => ({ default: m.StickerLanding })));
const StickersPage = lazyPage(() => import('./pages/Places').then((m) => ({ default: m.StickersPage })));
const FillPlace = lazyPage(() => import('./pages/FillPlace'));
const Thing = lazyPage(() => import('./pages/Thing'));
const Activities = lazyPage(() => import('./pages/Activities'));
const HomeReport = lazyPage(() => import('./pages/HomeReport'));
const WalkThrough = lazyPage(() => import('./pages/WalkThrough'));
const PetsPage = lazyPage(() => import('./pages/Pets'));
const PetPage = lazyPage(() => import('./pages/Pets').then((m) => ({ default: m.PetPage })));
const LicensesPage = lazyPage(() => import('./pages/Licenses'));
const ManualPage = lazyPage(() => import('./pages/Manual'));
const HomeServicesPage = lazyPage(() => import('./pages/HomeServices'));
const PackingPage = lazyPage(() => import('./pages/Packing'));
const UpkeepPage = lazyPage(() => import('./pages/Upkeep'));
const JobPage = lazyPage(() => import('./pages/Upkeep').then((m) => ({ default: m.JobPage })));
const RoutinesPage = lazyPage(() => import('./pages/Routines'));
const ChoreChart = lazyPage(() => import('./pages/ChoreChart'));
const CollectionPrint = lazyPage(() => import('./pages/CollectionPrint'));
const ThingStickersPage = lazyPage(() => import('./pages/ThingStickers').then((m) => ({ default: m.ThingStickersPage })));
const ThingStickerLanding = lazyPage(() => import('./pages/ThingStickers').then((m) => ({ default: m.ThingStickerLanding })));
const Money = lazyPage(() => import('./pages/Money'));
const GoalsPage = lazyPage(() => import('./pages/Budgeting').then((m) => ({ default: m.GoalsPage })));
const IncomePage = lazyPage(() => import('./pages/Budgeting').then((m) => ({ default: m.IncomePage })));
const YearPage = lazyPage(() => import('./pages/Budgeting').then((m) => ({ default: m.YearPage })));
const TagsPage = lazyPage(() => import('./pages/Tags'));
const TagPage = lazyPage(() => import('./pages/Tags').then((m) => ({ default: m.TagPage })));
const DoAction = lazyPage(() => import('./pages/DoAction'));
import { LifeFirstRun } from './components/LifeAreas';
import Search from './components/Search';
import AccessNote from './components/AccessNote';
import Art, { Stripe } from './components/Art';
import PageLoading from './components/PageLoading';
import lazyPage from './lazyPage';

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
// `word` is what Life Is calls the section inside (it is what people's choices are saved under, so it never
// changes); `shown` is the word people see; `icon` sits over the word in the bar along the bottom of a phone.
// In this order: what a household needs first, then what it plans, makes and enjoys.
const SECTIONS = [
  { word: 'eating', shown: 'tasty', icon: 'recipe', home: '/recipes', owns: (path) => ['/week', '/groceries', '/pantry', '/prices'].includes(path) || path.startsWith('/recipes'),
    tabs: [['/recipes', 'Recipes'], ['/week', 'Week'], ['/groceries', 'Groceries'], ['/pantry', 'Pantry'], ['/prices', 'Prices']] },
  { word: 'keeping', shown: 'tidy', icon: 'thing', home: '/things', owns: (path) => (path.startsWith('/things') && !path.startsWith('/things/activities')) || path.startsWith('/manual'),
    tabs: [['/things', 'Things'], ['/things/places', 'Places'], ['/things/upkeep', 'Upkeep'], ['/things/pets', 'Pets'], ['/things/licenses', 'Licenses'], ['/manual', 'House Manual'], ['/manual/services', 'Home services']] },
  { word: 'spending', shown: 'balanced', icon: 'bill', home: '/money', owns: (path) => path.startsWith('/money'), tabs: [['/money', 'This month'], ['/money/year', 'Year'], ['/money/goals', 'Goals'], ['/money/income', 'Income and bills']] },
  // Everything with a date or a time to it.
  { word: 'making', shown: 'busy', icon: 'date', home: '/calendar', owns: (path) => ['/calendar', '/routines', '/projects', '/plans', '/things/activities'].some((p) => path.startsWith(p)),
    tabs: [['/calendar', 'Calendar'], ['/routines', 'Routines'], ['/projects', 'Projects'], ['/plans', 'Plans'], ['/plans/holidays', 'Holidays'], ['/plans/trips', 'Trips'], ['/things/activities', 'Activities']] },
  { word: 'enjoying', shown: 'entertaining', icon: 'media', home: '/media', owns: (path) => path.startsWith('/media'),
    // The third place in a tab is the older addresses that still open it (the book shelves are now chips in the Collection).
    tabs: [['/media', 'Collection', ['/media/books', '/media/ebooks', '/media/audiobooks']], ['/media/lists', 'Lists'], ['/media/connections', 'Connections', ['/media/servers']]] },
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
  // A name saved in Settings shows at once, without signing out.
  useEffect(() => { window.addEventListener('lifeis:name-changed', check); return () => window.removeEventListener('lifeis:name-changed', check); }, [check]);
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
  // The calendar ("planning") lives in busy, so choosing it shows busy.
  const showing = SECTIONS.filter((s) => !life || life.sections.includes(s.word) || (s.word === 'making' && life.sections.includes('planning')) || s === section);
  const tabs = section ? section.tabs : [];
  const exact = (to) => ['/recipes', '/things', '/projects', '/media', '/calendar', '/plans', '/manual'].includes(to);
  return (
    <div className="safe-sides min-h-screen">
      <header className="safe-top sticky top-0 z-30 bg-life-bar text-white shadow-sm print:hidden">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 xl:max-w-6xl">
          {/* The header reads as a sentence: "Life is busy". The last word is a button that drops the others down. */}
          <div className="flex items-center gap-x-2" data-life-sentence>
            <Link to="/" className="flex items-center gap-2 font-semibold text-white">
              <img src="/mark-192.png" alt="" className="h-9 w-9" /> <span className="font-display text-lg font-bold leading-none">Life is</span> <Art slot="mark" className="-ml-0.5 h-6 w-6" />
            </Link>
            <SectionMenu showing={showing} section={section} atHome={pathname === '/'} />
          </div>
          <div className="order-2 ml-auto"><Search /></div>
          <NavLink to="/settings" aria-label="Settings" className="order-2 text-sm text-white/90 hover:text-white hover:underline"><span className="hidden sm:inline">Settings</span><span aria-hidden="true" className="sm:hidden"><Icon of="settings" size={22} /></span></NavLink>
          {tabs.length > 1 && (
            <nav className="order-4 flex w-full min-w-0 flex-wrap gap-1" aria-label={`Life is ${section.shown ?? section.word}`}>
              {tabs.map(([to, label, also = []]) => (
                <NavLink key={to} to={to} end={exact(to)} className={({ isActive }) => `flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1 text-sm font-medium sm:min-h-0 ${isActive || also.includes(pathname) ? 'bg-white/25 text-white' : 'text-white/80 hover:bg-white/15 hover:text-white'}`}>{label}</NavLink>
              ))}
            </nav>
          )}
        </div>
        {/* The bands of a 1970s kitchen (gold, orange, rust, brown), as a stripe under the bar. */}
        <Stripe />
      </header>
      <main className="mx-auto max-w-5xl px-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-4 sm:px-4 sm:pb-4 xl:max-w-6xl print:pb-4">
        {/* The page is a sheet of frosted glass over the cream (or coffee), so everything on it reads clearly. */}
        <div className="rounded-3xl bg-card/70 p-4 shadow-xl shadow-life-800/10 ring-1 ring-life-200/70 backdrop-blur-md dark:bg-life-900/75 dark:shadow-black/30 dark:ring-life-700 sm:p-6">
        {demo && (
          <p className="mb-4 rounded-xl bg-card/90 px-4 py-2.5 text-sm text-gray-700 shadow print:hidden dark:bg-life-800 dark:text-life-100" role="note" data-demo-banner>
            <strong className="text-life-700 dark:text-life-100">Demo.</strong> This household is made up, and everything is reset to the sample data each night. Try anything.
            Things that reach outside (email, look-ups, sharing links) are turned off here. <a href="https://lifeis.living" className="underline">About Life Is</a>
          </p>
        )}
        <AccessNote show={Boolean(section) && section.word !== 'eating' && pathname !== '/' && !pathname.startsWith('/settings')} pathname={pathname} />
        <Suspense fallback={<PageLoading />}>
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
          <Route path="/routines" element={<RoutinesPage />} />
          <Route path="/things/upkeep" element={<UpkeepPage />} />
          <Route path="/things/upkeep/chart" element={<ChoreChart />} />
          <Route path="/things/upkeep/:id" element={<JobPage />} />
          <Route path="/things/stickers" element={<ThingStickersPage />} />
          <Route path="/things/report" element={<HomeReport />} />
          <Route path="/things/packing" element={<PackingPage />} />
          <Route path="/manual" element={<ManualPage />} />
          <Route path="/manual/services" element={<HomeServicesPage />} />
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
          <Route path="/plans/holidays" element={<HolidaysPage />} />
          <Route path="/plans/holidays/:id" element={<HolidayPage />} />
          <Route path="/plans/holidays/:id/:planId" element={<HolidayPage />} />
          <Route path="/plans/trips" element={<TripsPage />} />
          <Route path="/plans/trips/:id" element={<TripPage />} />
          <Route path="/plans/trips/:id/:planId" element={<TripPage />} />
          <Route path="/plans/:id" element={<PlanPage />} />
          <Route path="/media" element={<MediaPage key="all" />} />
          <Route path="/media/books" element={<MediaPage key="books" library="books" />} />
          <Route path="/media/ebooks" element={<MediaPage key="ebooks" library="ebooks" />} />
          <Route path="/media/audiobooks" element={<MediaPage key="audiobooks" library="audiobooks" />} />
          <Route path="/media/print" element={<CollectionPrint />} />
          <Route path="/media/lists" element={<ListsPage />} />
          <Route path="/media/lists/:id" element={<ListPage />} />
          <Route path="/media/connections" element={<Servers />} />
          <Route path="/media/servers" element={<Servers />} />
          <Route path="/media/:id" element={<MediaTitlePage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/tags/:id" element={<TagPage />} />
          <Route path="/money" element={<Money />} />
          <Route path="/money/year" element={<YearPage />} />
          <Route path="/money/goals" element={<GoalsPage />} />
          <Route path="/money/income" element={<IncomePage />} />
          <Route path="/do/:id" element={<DoAction />} />
          <Route path="/settings" element={<Settings user={user} onLogout={onLogout} onLifeChanged={setLife} />} />
          <Route path="/settings/:group" element={<Settings user={user} onLogout={onLogout} onLifeChanged={setLife} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </div>
      </main>
      {/* Phones: the heart and "Life is" (Home) and the sections along the bottom, an icon over each word, always
          on screen and in reach of a thumb. Hidden from the sm breakpoint up, where the drop-down in the header does it. */}
      <nav aria-label="Home and sections" className="safe-bottom fixed inset-x-0 bottom-0 z-30 bg-life-bar text-white shadow-[0_-2px_8px_rgba(0,0,0,0.15)] sm:hidden print:hidden">
        <div className="safe-sides flex">
          <BarLink to="/" mark word="Life is" current={pathname === '/'} />
          {showing.map((s) => <BarLink key={s.word} to={s.home} icon={s.icon} word={s.shown ?? s.word} current={s === section} />)}
        </div>
      </nav>
      <LifeFirstRun open={!!life && life.areas === null} onDone={(data) => (data ? setLife(data) : loadLife())} />
    </div>
  );
}

/** "Life is ..." as a drop-down: the current section's word, and under it Home and the five sections. */
function SectionMenu({ showing, section, atHome }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const { pathname } = useLocation();
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { setOpen(false); box.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const word = section ? (section.shown ?? section.word) : atHome ? 'home' : '';
  const row = (current) => `flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-1 font-display text-lg font-bold ${current ? 'bg-avocado-100 text-avocado-800' : 'text-white hover:bg-white/15'}`;
  return (
    <div ref={box} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} aria-label={word ? undefined : 'Choose a section'} onClick={() => setOpen((o) => !o)}
        className="flex min-h-[44px] items-center gap-1 rounded-lg px-1 font-display text-lg font-bold leading-none text-avocado-100 hover:text-white">
        {word && <span className="underline decoration-dotted decoration-2 underline-offset-4">{word}</span>}
        <svg aria-hidden="true" viewBox="0 0 10 6" className={`h-2 w-3 fill-current transition-transform ${open ? 'rotate-180' : ''}`}><path d="M0 0h10L5 6z" /></svg>
      </button>
      {open && (
        <nav aria-label="Sections" className="absolute left-0 top-full z-40 mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-2xl bg-life-bar p-2 text-white shadow-xl ring-1 ring-white/20">
          <p className="px-3 pb-1 pt-1 text-sm text-white/70">Life is ...</p>
          <Link to="/" aria-current={atHome ? 'page' : undefined} className={row(atHome)}><Icon of="home" size={22} /><span>home</span></Link>
          {showing.map((s) => (
            <Link key={s.word} to={s.home} aria-current={s === section ? 'page' : undefined} className={row(s === section)}><Icon of={s.icon} size={22} /><span>{s.shown ?? s.word}</span></Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/** One place in the bar along the bottom of a phone: an icon (or the heart) over its word, at least 56px tall. */
function BarLink({ to, icon, mark = false, word, current }) {
  return (
    <Link to={to} aria-current={current ? 'page' : undefined}
      className={`flex min-h-[56px] min-w-max flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-1.5 pb-1 text-[11px] font-semibold leading-tight ${current ? 'text-avocado-100' : 'text-white/80 hover:text-white'}`}>
      <span className={`flex h-7 w-11 items-center justify-center rounded-full ${current ? 'bg-avocado-100 text-avocado-800' : ''}`}>
        {mark ? <img src="/mark-192.png" alt="" className="h-6 w-6" /> : <Icon of={icon} size={20} />}
      </span>
      <span className="whitespace-nowrap">{word}</span>
    </Link>
  );
}
