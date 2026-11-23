import { useEffect, useRef, useState } from 'react';
import CopyButton from '../components/Copy';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { LifeAreasPicker } from '../components/LifeAreas';
import { chooseAgain, inApp, linkedServer, onDevice, serverOrigin } from '../where';
import { AssistantService } from '../components/Assistant';
import { RemindersSettings } from '../components/Reminders';
import { RecallAlertsService } from '../components/Recalls';
import { PeopleSignIn, SignInSecurity } from '../components/Security';
import YourFiles from '../components/YourFiles';

const IDLE_TEXT = { 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', 120: '2 hours', 480: '8 hours', 0: 'Stay signed in' };

// ==================== LAYOUT ====================

// Settings are split into groups, one shown at a time, the way Sworkr's are. Each section has an id, so a link
// like /settings#unlock (or /settings/data#unlock) opens the right group and scrolls to it. `words` are extra
// search terms for the filter box. `when` leaves a section out where it doesn't apply (the app, a server).
const server = () => !onDevice();
const GROUPS = [
  {
    id: 'home', label: 'Your home', icon: '🏠',
    sections: [
      { id: 'life', title: 'What Life Is looks after', words: 'sections areas sewing garden cookware clothing money spending show hide', render: ({ onLifeChanged }) => <Titled title="What Life Is looks after" hint="Decides which sections show. Nothing is removed by unchecking."><LifeAreasPicker onSaved={onLifeChanged} /></Titled> },
    ],
  },
  {
    id: 'reminders', label: 'Reminders', icon: '🔔',
    sections: [
      { id: 'reminders', title: 'Reminders that reach you', words: 'notify notification notifications push ntfy email digest morning alert remind phone browser', render: () => <Titled title="Reminders that reach you"><RemindersSettings /></Titled> },
    ],
  },
  {
    id: 'calendars', label: 'Calendars', icon: '📅',
    sections: [
      { id: 'calendar-link', title: 'Your phone’s calendar', words: 'apple google ical ics subscribe link feed outlook', when: server, render: () => <CalendarLink /> },
      { id: 'other-calendars', title: 'Other calendars', words: 'follow ical ics sworkr busy google apple work', render: () => <Plain><OtherCalendarsService /></Plain> },
    ],
  },
  {
    id: 'connections', label: 'Connections', icon: '🔗',
    hint: 'Life Is keeps what you write on this computer and works without any of these. Each one is off until you turn it on, says exactly what it sends, and can be turned off again. This list is all of them.',
    sections: [
      { id: 'assistant', title: 'AI assistant', words: 'ai llm ollama lm studio chatgpt claude gemini model ask question', render: () => <Plain><AssistantService /></Plain> },
      { id: 'weather', title: 'Weather', words: 'forecast open-meteo town place', render: () => <Plain><WeatherService /></Plain> },
      { id: 'mail', title: 'Email', words: 'imap smtp inbox mail gmail icloud', render: () => <Plain><MailService /></Plain> },
      { id: 'lookups', title: 'Barcode lookups', words: 'isbn book grocery film music game album dvd blu-ray vinyl scan open library food facts musicbrainz upcitemdb', render: () => <Plain><BookLookupService /></Plain> },
      { id: 'photos', title: 'Photos from Immich', words: 'immich pictures plans memories', render: () => <Plain><PhotoLibraryService /></Plain> },
      { id: 'media', title: 'Jellyfin or Emby', words: 'media server films shows music jellyfin emby', render: () => <MediaServers /> },
      { id: 'recalls', title: 'Recall alerts', words: 'car vehicle recall nhtsa safety make model year vin', render: () => <Plain><RecallAlertsService /></Plain> },
      { id: 'recipe-web', title: 'Recipes from a website', words: 'import url link page photo ocr', render: () => <RecipesFromWeb /> },
    ],
  },
  {
    id: 'account', label: onDevice() ? 'This device' : 'Account & sign-in', icon: '🔒',
    sections: [
      { id: 'kept-here', title: 'Kept on this device', words: 'phone device server connect host', when: onDevice, render: () => <KeptHere /> },
      { id: 'linked', title: 'Connected to your Life Is', words: 'server disconnect host', when: () => Boolean(linkedServer()), render: () => <Linked /> },
      { id: 'idle', title: 'Signing out by itself', words: 'idle timeout log out automatic', when: server, render: () => <SignedOut /> },
      { id: 'password', title: 'Password', words: 'change password', when: server, render: () => <PasswordForm /> },
      { id: 'security', title: 'Sign-in security', words: 'two-step 2fa authenticator totp passkey recovery codes fingerprint face webauthn lock', when: server, render: () => <SignInSecurity /> },
      { id: 'people', title: 'People in this Life Is', words: 'user account add family person locked out two-step passkey', when: (user) => server() && user.is_admin, render: () => <div className="space-y-4"><AddPerson /><PeopleSignIn /></div> },
      { id: 'sign-out', title: 'Sign out', words: 'log out leave', when: server, render: ({ user, onLogout }) => <Titled title="Sign out" hint={`Signed in as ${user.username}.`}><button type="button" onClick={onLogout} className={quietButtonClass}>Sign out</button></Titled> },
    ],
  },
  {
    id: 'data', label: 'Your data', icon: '🗄',
    sections: [
      { id: 'unlock', title: 'Unlocking Life Is', words: 'trial pay price purchase buy free', when: onDevice, render: () => <Unlock /> },
      { id: 'backup', title: 'Backups', words: 'backup restore export file passphrase drive icloud', when: onDevice, render: () => <DeviceBackup /> },
      { id: 'your-files', title: 'Download everything, and bring it back in', words: 'download everything export import bring in zip csv spreadsheet open files data stays with you portable pictures merge', render: () => <YourFiles hasBackup={onDevice()} /> },
      { id: 'recipes-out', title: 'Download recipes', words: 'export nextcloud cookbook zip', when: () => !inApp(), render: () => <RecipesOut /> },
    ],
  },
];

function Titled({ title, hint, children }) {
  return (
    <section className={cardClass}>
      <h2 className="font-semibold text-life-800 dark:text-life-50">{title}</h2>
      {hint && <p className="mt-1 text-sm text-gray-600 dark:text-life-100">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
/** A setting that already says what it is (the outside services each carry their own heading). */
const Plain = ({ children }) => <div className={`${cardClass} space-y-6 [&>div]:py-0 [&_h3]:font-semibold [&_h3]:text-life-800 dark:[&_h3]:text-life-50`}>{children}</div>;

const visibleGroups = (user) => GROUPS
  .map((g) => ({ ...g, sections: g.sections.filter((s) => !s.when || s.when(user)) }))
  .filter((g) => g.sections.length);

export default function Settings({ user, onLogout, onLifeChanged }) {
  const { group: groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const groups = visibleGroups(user);
  const group = groups.find((g) => g.id === groupId);
  const [query, setQuery] = useState('');

  // A link straight to a section (/settings#unlock) finds the group it is in.
  const hash = location.hash.slice(1);
  const owner = hash && groups.find((g) => g.sections.some((s) => s.id === hash));
  useEffect(() => {
    if (!hash || !group) return undefined;
    // Again a little later: sections above it load their settings and grow, pushing it down.
    const go = () => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
    const timers = [setTimeout(go, 300), setTimeout(go, 1000)];
    return () => timers.forEach(clearTimeout);
  }, [hash, group]);

  if (owner && owner.id !== groupId) return <Navigate to={`/settings/${owner.id}#${hash}`} replace />;
  if (groupId && !group) return <Navigate to="/settings" replace />;

  const q = query.trim().toLowerCase();
  const matches = q
    ? groups.flatMap((g) => g.sections.filter((s) => `${s.title} ${s.words || ''} ${g.label}`.toLowerCase().includes(q)).map((s) => ({ group: g, section: s })))
    : null;
  const open = (g, s) => { setQuery(''); navigate(s ? `/settings/${g.id}#${s.id}` : `/settings/${g.id}`); };
  // On a phone, /settings is the list of groups and a group opens on its own page. On a wider screen the
  // menu is always there and /settings shows the first group.
  const shown = group || groups[0];

  const search = <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a setting" aria-label="Find a setting" className={inputClass} />;
  const results = matches && (
    <ul className="space-y-1">
      {matches.length === 0 && <li className="px-3 py-2 text-sm text-gray-500 dark:text-life-300">Nothing matches “{query}”.</li>}
      {matches.map(({ group: g, section: s }) => (
        <li key={`${g.id}-${s.id}`}>
          <button type="button" onClick={() => open(g, s)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-life-50 dark:hover:bg-life-800">
            <span className="text-gray-800 dark:text-life-50">{s.title}</span>
            <span className="block text-xs text-gray-500 dark:text-life-300">{g.label}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Settings</h1>
        {!onDevice() && <p className="text-sm text-gray-600 dark:text-life-200">Signed in as <span className="font-medium">{user.username}</span>{user.is_admin ? ' (admin)' : ''}</p>}
      </div>

      {/* Phone: the list of groups, until one is picked. */}
      {!group && (
        <div className={`${cardClass} space-y-3 md:hidden`} data-settings-groups>
          {search}
          {results || (
            <ul className="divide-y divide-life-100 dark:divide-life-700">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link to={`/settings/${g.id}`} className="flex items-center gap-3 px-1 py-3 text-gray-800 dark:text-life-50">
                    <span aria-hidden="true" className="text-xl">{g.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{g.label}</span>
                      <span className="block truncate text-xs text-gray-500 dark:text-life-300">{g.sections.map((s) => s.title).join(', ')}</span>
                    </span>
                    <span className="text-gray-400" aria-hidden="true">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className={`${group ? 'grid' : 'hidden md:grid'} items-start gap-4 md:grid-cols-[13rem_1fr]`}>
        {/* Wider screens: the menu beside the settings. */}
        <nav aria-label="Settings" className={`${cardClass} sticky top-24 hidden space-y-2 !p-2 md:block`}>
          {search}
          {results || (
            <ul className="space-y-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <Link to={`/settings/${g.id}`} aria-current={g.id === shown.id ? 'page' : undefined}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${g.id === shown.id ? 'bg-life-50 font-semibold text-life-800 dark:bg-life-700 dark:text-life-50' : 'text-gray-700 hover:bg-life-50 dark:text-life-100 dark:hover:bg-life-800'}`}>
                    <span aria-hidden="true">{g.icon}</span>{g.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="min-w-0 max-w-2xl space-y-4" data-settings-group={shown.id}>
          <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-life-600 hover:underline dark:text-life-200 md:hidden">‹ All settings</Link>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-life-800 dark:text-life-50"><span aria-hidden="true">{shown.icon}</span>{shown.label}</h2>
          {shown.hint && <p className="text-sm text-gray-600 dark:text-life-100">{shown.hint}</p>}
          {shown.sections.map((s) => (
            <div key={s.id} id={s.id} className="scroll-mt-24">{s.render({ user, onLogout, onLifeChanged })}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function KeptHere() {
  return (
    <Titled title="Kept on this device">
      <p className="text-sm text-gray-600 dark:text-life-100">Everything you write in Life Is stays on this device, locked with a key only this device holds. There is no account and no password: the device's own lock is what keeps it yours.</p>
      <p className="mt-2 text-sm text-gray-600 dark:text-life-100">If you run Life Is on a computer of your own, this app can show that one instead. What is on this device stays here, untouched, and is not copied across.</p>
      <button type="button" onClick={chooseAgain} className={`${quietButtonClass} mt-3`}>Connect to a Life Is I host</button>
    </Titled>
  );
}

function Linked() {
  return (
    <Titled title="Connected to your Life Is">
      <p className="text-sm text-gray-600 dark:text-life-100">This app is showing the Life Is at <span className="break-all font-medium">{linkedServer()}</span>. Everything is kept there; this phone holds only that address and your sign-in.</p>
      <button type="button" onClick={chooseAgain} className={`${quietButtonClass} mt-3`}>Disconnect this phone</button>
    </Titled>
  );
}

function RecipesOut() {
  return (
    <Titled title="Your recipes, yours to take" hint="Download every recipe as Nextcloud Cookbook folders (each one a recipe.json, with the original text beside it). Unzip them into the Recipes folder in your Nextcloud and the Cookbook app shows them.">
      <a href="/api/kitchen/recipes-export.zip" className={quietButtonClass}>Download recipes</a>
    </Titled>
  );
}

function MediaServers() {
  return (
    <Titled title="📺 Your Jellyfin or Emby" hint="Brings the films, shows, music and books on a media server you name into your collection. Life Is only reads from that server, using the key you give it, and talks to nowhere else.">
      <Link to="/media/servers" className="text-sm text-life-600 hover:underline dark:text-life-200">Media servers →</Link>
    </Titled>
  );
}

function RecipesFromWeb() {
  return (
    <Titled title="🍳 Recipes from a website" hint='Nothing to turn on. Only when you paste an address under Recipes → "Bring one in", Life Is fetches that one page from that site, as a browser would; nothing about you or your recipes is sent. Reading a recipe off a photo happens on your own device and reaches nowhere.' />
  );
}

/** On the device: what is free, where the trial of the rest stands, and unlocking it. */
function Unlock() {
  const [access, setAccess] = useState(null);
  useEffect(() => { axios.get('/api/access').then(({ data }) => setAccess(data)).catch(() => {}); }, []);
  if (!access) return null;
  const days = access.days_left;
  return (
    <section className={cardClass} data-access={access.state}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{access.state === 'unlocked' ? 'Life Is is unlocked' : 'Unlocking Life Is'}</h2>
      {access.state === 'unlocked' ? (
        <p className="text-sm text-gray-600 dark:text-life-100">Every part of Life Is is yours on this device, for good. Thank you.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">The kitchen (recipes, the week, groceries, the pantry, prices) and backups are free for good. Everything else is one payment of {access.price}: no subscription, nothing to renew.</p>
          <p className="mt-2 text-sm text-gray-600 dark:text-life-100">
            {access.state === 'unstarted' && `You can try all of it free for ${access.trial_days} days. The days start counting when you first add something outside the kitchen.`}
            {access.state === 'trial' && `Your free trial has ${days} ${days === 1 ? 'day' : 'days'} left.`}
            {access.state === 'ended' && 'Your free trial has ended. Nothing you entered has been hidden or removed: it can all still be read and backed up, and can be changed again once unlocked.'}
          </p>
          <p className="mt-3 rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-50">Paying is done through the app store, and arrives when Life Is is in the store. This copy isn't from the store yet.</p>
        </>
      )}
    </section>
  );
}

/** On the device: everything as one locked file to keep somewhere else, and bringing such a file back. */
function DeviceBackup() {
  const [doing, setDoing] = useState(null); // 'save' | 'restore'
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const start = (what) => { setDoing(what); setPass(''); setAgain(''); setFile(null); setError(''); setSaid(''); };

  const save = async (e) => {
    e.preventDefault();
    if (pass !== again) { setError("The two passphrases aren't the same"); return; }
    setBusy(true); setError('');
    try {
      const { data } = await axios.post('/api/device/backup', { passphrase: pass }, { responseType: 'arraybuffer' });
      const now = new Date(); // the day it is here, not in Greenwich
      const name = `life-is-backup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.lifeis`;
      const { handOver } = await import('../device/handOver.js');
      await handOver(new Uint8Array(data), name);
      setDoing(null);
      setSaid(`Made ${name}. Keep it wherever you like; without the passphrase it is unreadable.`);
    } catch (err) { setError(errorMessage(err, "Couldn't make the backup")); }
    setBusy(false);
  };
  const restore = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = '';
      for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      await axios.post('/api/device/restore', { passphrase: pass, file: btoa(text) });
      await window.lifeisDevice?.saved?.();
      window.location.replace('/');
    } catch (err) { setError(errorMessage(err, "Couldn't bring that backup back")); setBusy(false); }
  };

  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">A backup you hold</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">Life Is makes no copies of itself anywhere. If this device is lost, so is what it holds, unless you have made a backup: one file with everything in it, locked with a passphrase you choose. You can put the file anywhere, a cloud drive included; whoever stores it can't read it.</p>
      {said && <p className="mt-2 rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-50" role="status">{said}</p>}
      {doing === null && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => start('save')} className={buttonClass}>Make a backup</button>
          <button type="button" onClick={() => start('restore')} className={quietButtonClass}>Bring a backup back</button>
        </div>
      )}
      {doing === 'save' && (
        <form onSubmit={save} className="mt-3 space-y-3">
          <Field label="A passphrase for this backup"><input type="password" required minLength={8} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={inputClass} /></Field>
          <Field label="The same passphrase again"><input type="password" required minLength={8} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} /></Field>
          <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Write the passphrase down somewhere safe. Life Is doesn't keep it, and nobody, including whoever made Life Is, can open the backup without it.</p>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setDoing(null)} className={quietButtonClass}>Cancel</button><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Locking it…' : 'Make the backup'}</button></div>
        </form>
      )}
      {doing === 'restore' && (
        <form onSubmit={restore} className="mt-3 space-y-3">
          <Field label="The backup file"><input type="file" required onChange={(e) => setFile(e.target.files[0] ?? null)} className="block w-full text-sm" /></Field>
          <Field label="Its passphrase"><input type="password" required autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className={inputClass} /></Field>
          <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">This replaces everything on this device with what the backup holds. What is here now, and isn't in the backup, will be gone.</p>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setDoing(null)} className={quietButtonClass}>Cancel</button><button type="submit" disabled={busy || !file} className={buttonClass}>{busy ? 'Bringing it back…' : 'Replace what is here'}</button></div>
        </form>
      )}
    </section>
  );
}

function SignedOut() {
  const [data, setData] = useState(null);
  useEffect(() => { axios.get('/api/account').then(({ data: d }) => setData(d)).catch(() => {}); }, []);
  if (!data) return null;
  const save = async (e) => { const { data: d } = await axios.put('/api/account', { idle_minutes: Number(e.target.value) }); setData(d); };
  return (
    <section className={cardClass}>
      <Field label="Sign out after this long without use">
        <select value={data.idle_minutes} onChange={save} className={`${inputClass} !w-auto`}>
          {data.idle_choices.map((m) => <option key={m} value={m}>{IDLE_TEXT[m] || `${m} minutes`}</option>)}
        </select>
      </Field>
    </section>
  );
}

function PasswordForm() {
  const [form, setForm] = useState({ current_password: '', new_password: '' });
  const [message, setMessage] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/auth/change-password', form);
      setForm({ current_password: '', new_password: '' });
      setMessage('Changed. Other devices are signed out.');
    } catch (err) {
      setMessage(errorMessage(err, "Couldn't change it"));
    }
  };
  return (
    <form onSubmit={submit} className={`${cardClass} space-y-3`}>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Password</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Current password"><input type="password" autoComplete="current-password" required value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} className={inputClass} /></Field>
        <Field label="New password (12 or more)"><input type="password" autoComplete="new-password" required minLength={12} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} className={inputClass} /></Field>
      </div>
      {message && <p className="text-sm text-gray-700 dark:text-life-100">{message}</p>}
      <button type="submit" className={buttonClass}>Change password</button>
    </form>
  );
}

function AddPerson() {
  const [form, setForm] = useState({ username: '', password: '' });
  const [message, setMessage] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/users', form);
      setMessage(`${form.username} can sign in now, with a kitchen of their own.`);
      setForm({ username: '', password: '' });
    } catch (err) {
      setMessage(errorMessage(err, "Couldn't add them"));
    }
  };
  return (
    <form onSubmit={submit} className={`${cardClass} space-y-3`}>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Someone else in the house</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Username"><input required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={inputClass} /></Field>
        <Field label="Their password (12 or more)"><input type="password" autoComplete="new-password" required minLength={12} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} /></Field>
      </div>
      {message && <p className="text-sm text-gray-700 dark:text-life-100">{message}</p>}
      <button type="submit" className={buttonClass}>Add them</button>
    </form>
  );
}

/**
 * A link the calendar app on a phone can follow, so Life Is's calendar shows there too. Off until made.
 * It only shows: nothing can be changed through it.
 */
function CalendarLink() {
  const [link, setLink] = useState(null);
  const [kinds, setKinds] = useState([]);
  const [error, setError] = useState('');
  const addressField = useRef(null);
  const took = (data) => { setLink(data); setKinds(data.kinds); setError(''); };
  useEffect(() => { axios.get('/api/calendar/link').then(({ data }) => took(data)).catch(() => {}); }, []);
  if (!link) return null;
  const ask = async (send) => { try { took((await send()).data); } catch (err) { setError(errorMessage(err, "Couldn't do that")); } };
  const tick = (key, on) => {
    const next = on ? [...kinds, key] : kinds.filter((k) => k !== key);
    setKinds(next);
    // Once the link exists, a tick is saved straight away; before that it waits for "Make a link".
    if (link.on && next.length > 0) ask(() => axios.put('/api/calendar/link', { kinds: next }));
  };
  const address = link.token ? `${serverOrigin()}/cal/${link.token}.ics` : '';
  const onThisComputerOnly = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(serverOrigin()).hostname);
  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Your calendar on your phone</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-life-100">
        Shows Life Is's calendar inside the calendar app you already use (Apple Calendar, and any other that can follow a link).
        It only shows: nothing can be changed through it. Off until you make a link.
      </p>
      <fieldset className="mb-3">
        <legend className="mb-1 text-sm font-medium text-gray-800 dark:text-life-50">What it shows</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {link.choices.map((choice) => (
            <label key={choice.key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
              <input type="checkbox" checked={kinds.includes(choice.key)} onChange={(e) => tick(choice.key, e.target.checked)} />
              {choice.label}
            </label>
          ))}
        </div>
        {kinds.length === 0 && <p className="mt-1 text-xs text-red-600">Check at least one.</p>}
      </fieldset>
      {!link.on ? (
        <button type="button" disabled={kinds.length === 0} onClick={() => ask(() => axios.put('/api/calendar/link', { kinds }))} className={buttonClass}>Make a link</button>
      ) : (
        <div className="space-y-3">
          <Field label="Your link">
            <input ref={addressField} readOnly value={address} onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <a href={address.replace(/^https?:/, 'webcal:')} className={buttonClass}>Add to this device's calendar</a>
            <CopyButton text={address} what="the calendar link" label="Copy the link" selectRef={addressField} />
          </div>
          {onThisComputerOnly && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              You're on the computer Life Is runs on, so this link only works here. Open Life Is on your phone, at the address you use there, and add it from this same page.
            </p>
          )}
          <ul className="list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-life-200">
            <li>Anyone who has this link can read what's checked above, without a password. Treat it like a key, and don't post it anywhere.</li>
            <li>It reaches from {link.days_back} days back to a year ahead, and a calendar app looks again about once an hour, so a change takes a little while to show.</li>
            <li>A calendar app on your own phone or computer fetches it straight from your Life Is. An online calendar (Google Calendar, Outlook on the web) fetches it from that company's computers, so they would see what's in it.</li>
            <li>{link.read_at ? `Last fetched ${new Date(link.read_at).toLocaleString()}.` : 'Nothing has fetched it yet.'}</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { if (window.confirm('Make a new link? The old one stops working, and each calendar that follows it has to be given the new one.')) ask(() => axios.post('/api/calendar/link/renew')); }} className={quietButtonClass}>Make a new link</button>
            <button type="button" onClick={() => { if (window.confirm('Turn the link off? Calendars following it stop getting anything.')) ask(() => axios.delete('/api/calendar/link')); }} className={quietButtonClass}>Turn it off</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

/** Everything that reaches outside this computer, in one place. Each is off until turned on, and says what it sends. */

const placeLabel = (p) => [p.name, p.region, p.country].filter(Boolean).join(', ');

function WeatherService() {
  const [w, setW] = useState(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState(null);
  const [units, setUnits] = useState('f');
  const [message, setMessage] = useState('');
  useEffect(() => { axios.get('/api/weather').then(({ data }) => { setW(data); if (data.place) setUnits(data.place.units); }).catch(() => {}); }, []);
  if (!w) return null;
  const search = async (e) => {
    e.preventDefault();
    setMessage('');
    try {
      const { data } = await axios.get('/api/weather/places', { params: { q } });
      setFound(data);
      if (data.length === 0) setMessage('No place by that name was found.');
    } catch (err) { setMessage(errorMessage(err, "Couldn't look that up")); }
  };
  const turnOn = async (place, withUnits = units) => {
    try {
      const { data } = await axios.put('/api/weather', { name: place.region !== undefined ? placeLabel(place) : place.name, latitude: place.latitude, longitude: place.longitude, units: withUnits });
      setW(data); setFound(null); setQ(''); setMessage('');
    } catch (err) { setMessage(errorMessage(err, "Couldn't turn it on")); }
  };
  const turnOff = async () => { const { data } = await axios.delete('/api/weather'); setW(data); setMessage(''); };
  const changeUnits = (e) => { setUnits(e.target.value); if (w.place) turnOn(w.place, e.target.value); };
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">🌤 Weather on the front page</h3>
        <span className={`rounded px-1.5 text-[11px] ${w.place ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{w.place ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        From <a href={w.service.site} target="_blank" rel="noreferrer" className="underline">{w.service.name}</a>, a free weather service. <span className="font-medium">What it's sent:</span> {w.service.sends}
      </p>
      {!w.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so the weather can't be turned on.</p> : (
        <div className="mt-2 space-y-2">
          {w.place && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-life-50">
              <span className="mr-auto">Showing <span className="font-medium">{w.place.name}</span></span>
              <button type="button" onClick={turnOff} className={quietButtonClass}>Turn off and forget the place</button>
            </div>
          )}
          <form onSubmit={search} className="flex flex-wrap items-end gap-2">
            <Field label={w.place ? 'Change the place' : 'Your town, to turn it on'}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Springfield" minLength={2} required className={inputClass} /></Field>
            <Field label="Degrees">
              <select value={units} onChange={changeUnits} className={`${inputClass} !w-auto`}><option value="f">Fahrenheit</option><option value="c">Celsius</option></select>
            </Field>
            <button type="submit" className={quietButtonClass}>Look it up</button>
          </form>
          {found && found.length > 0 && (
            <ul className="space-y-1">
              {found.map((p) => (
                <li key={`${p.latitude},${p.longitude}`}>
                  <button type="button" onClick={() => turnOn(p)} className="w-full rounded-lg px-2 py-1 text-left text-sm text-gray-800 hover:bg-life-50 dark:text-life-50 dark:hover:bg-life-700">{placeLabel(p)}</button>
                </li>
              ))}
            </ul>
          )}
          {message && <p className="text-sm text-gray-700 dark:text-life-100">{message}</p>}
        </div>
      )}
    </div>
  );
}

// Where the well-known providers keep their servers, so most people only type an address and a password.
const MAIL_PROVIDERS = [
  { match: /@(gmail|googlemail)\.com$/, imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
    hint: 'Gmail needs an "app password": in your Google account, turn on 2-step verification, then make an app password and use it here instead of your everyday one.' },
  { match: /@(icloud|me|mac)\.com$/, imap_host: 'imap.mail.me.com', imap_port: 993, smtp_host: 'smtp.mail.me.com', smtp_port: 587,
    hint: 'iCloud needs an "app-specific password", made at account.apple.com under Sign-In and Security.' },
  { match: /@(yahoo|ymail)\.[a-z.]+$/, imap_host: 'imap.mail.yahoo.com', imap_port: 993, smtp_host: 'smtp.mail.yahoo.com', smtp_port: 465,
    hint: 'Yahoo needs an "app password", made in your account\'s security settings.' },
  { match: /@(fastmail\.[a-z]+|sent\.com)$/, imap_host: 'imap.fastmail.com', imap_port: 993, smtp_host: 'smtp.fastmail.com', smtp_port: 465,
    hint: 'Fastmail needs an "app password" (Settings, Privacy & Security, Integrations), with access to mail.' },
  { match: /@(outlook|hotmail|live|msn)\.[a-z.]+$/, imap_host: 'outlook.office365.com', imap_port: 993, smtp_host: 'smtp-mail.outlook.com', smtp_port: 587,
    hint: 'Microsoft has been switching off password sign-in for mail programs. If this is refused, Outlook can\'t be connected here yet.' },
  { match: /@(proton\.me|protonmail\.com|pm\.me)$/, imap_host: '127.0.0.1', imap_port: 1143, smtp_host: '127.0.0.1', smtp_port: 1025, local: true,
    hint: 'Proton Mail only works through its Bridge app, running on the same computer as Life Is. Use the server names, ports and password Bridge shows.' },
];
const EMPTY_ACCOUNT = { address: '', name: '', password: '', username: '', imap_host: '', imap_port: 993, smtp_host: '', smtp_port: 465, local: false };

function MailService() {
  const [setup, setSetup] = useState(null);
  const [form, setForm] = useState(null);       // null: not adding
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const load = () => axios.get('/api/mail').then(({ data }) => setSetup(data)).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!setup) return null;
  const provider = form ? MAIL_PROVIDERS.find((p) => p.match.test(form.address.trim().toLowerCase())) : null;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  // Typing the address fills in where its servers are, until the person changes them by hand.
  const setAddress = (e) => {
    const address = e.target.value;
    const known = MAIL_PROVIDERS.find((p) => p.match.test(address.trim().toLowerCase()));
    const domain = address.includes('@') ? address.trim().toLowerCase().split('@')[1] : '';
    const guess = known || (domain ? { imap_host: `imap.${domain}`, imap_port: 993, smtp_host: `smtp.${domain}`, smtp_port: 465 } : {});
    setForm(details ? { ...form, address } : { ...form, address, imap_host: guess.imap_host || '', imap_port: guess.imap_port || 993, smtp_host: guess.smtp_host || '', smtp_port: guess.smtp_port || 465, local: Boolean(guess.local) });
  };
  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage('');
    try {
      await axios.post('/api/mail/accounts', { ...form, name: form.name || null, username: form.username || null, imap_port: Number(form.imap_port), smtp_port: Number(form.smtp_port) });
      setForm(null); setDetails(false); await load();
    } catch (err) { setMessage(errorMessage(err, "Couldn't add it")); }
    setBusy(false);
  };
  const remove = async (id) => { await axios.delete(`/api/mail/accounts/${id}`).catch(() => {}); load(); };
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">✉️ Email: read and answer your inbox</h3>
        <span className={`rounded px-1.5 text-[11px] ${setup.accounts.length ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{setup.accounts.length ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Works with any provider that lets mail programs in (IMAP and SMTP). <span className="font-medium">What it does:</span> {setup.service.sends}</p>
      {!setup.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so email can't be turned on.</p> : (
        <div className="mt-2 space-y-2">
          {setup.accounts.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-life-50">
              <span className="mr-auto"><span className="font-medium">{a.address}</span> <span className="text-xs text-gray-500 dark:text-life-300">{a.imap_host}</span></span>
              <button type="button" onClick={() => remove(a.id)} className={quietButtonClass}>Remove and forget its password</button>
            </div>
          ))}
          {!form ? <button type="button" onClick={() => { setForm(EMPTY_ACCOUNT); setMessage(''); }} className={quietButtonClass}>+ Add an email account</button> : (
            <form onSubmit={add} className="space-y-3 rounded-lg bg-life-50/60 p-3 dark:bg-life-800">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Email address *"><input required type="email" autoComplete="off" value={form.address} onChange={setAddress} className={inputClass} /></Field>
                <Field label="Password, or app password *"><input required type="password" autoComplete="new-password" value={form.password} onChange={set('password')} className={inputClass} /></Field>
                <Field label="Your name, as replies should show it"><input value={form.name} onChange={set('name')} className={inputClass} /></Field>
              </div>
              {provider && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">{provider.hint}</p>}
              <button type="button" onClick={() => setDetails(!details)} className="text-sm text-life-600 hover:underline dark:text-life-200">{details ? 'Hide' : 'Show'} the server details{form.imap_host ? ` (${form.imap_host})` : ''}</button>
              {details && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="sm:col-span-3"><Field label="Incoming server (IMAP)"><input required value={form.imap_host} onChange={set('imap_host')} placeholder="imap.example.com" className={inputClass} /></Field></div>
                  <Field label="Port"><input required type="number" min="1" max="65535" value={form.imap_port} onChange={set('imap_port')} className={inputClass} /></Field>
                  <div className="sm:col-span-3"><Field label="Outgoing server (SMTP)"><input required value={form.smtp_host} onChange={set('smtp_host')} placeholder="smtp.example.com" className={inputClass} /></Field></div>
                  <Field label="Port"><input required type="number" min="1" max="65535" value={form.smtp_port} onChange={set('smtp_port')} className={inputClass} /></Field>
                  <div className="sm:col-span-4"><Field label="Username, if it isn't the address"><input autoComplete="off" value={form.username} onChange={set('username')} className={inputClass} /></Field></div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-life-50 sm:col-span-4">
                    <input type="checkbox" checked={form.local} onChange={set('local')} className="mt-0.5 accent-life-600" />
                    <span>On my own computer or network <span className="block text-xs text-gray-500 dark:text-life-300">Only for a mail server at home (or Proton Bridge). Everywhere else the line is always encrypted and the server's identity checked.</span></span>
                  </label>
                </div>
              )}
              {message && <p className="text-sm text-red-600">{message}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => { setForm(null); setDetails(false); }} className={quietButtonClass}>Not now</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Signing in to check…' : 'Sign in and add'}</button>
              </div>
              <p className="text-xs text-gray-500 dark:text-life-300">The account is only saved if signing in works. The password is stored locked, on this computer.</p>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

const SHOW_WORDS = { busy: 'busy only', titles: 'with what each thing is called' };

/** Calendars kept somewhere else, shown on Life Is's own by following their link. Busy only unless asked for more. */
function OtherCalendarsService() {
  const [o, setO] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { axios.get('/api/calendar/others').then(({ data }) => setO(data)).catch(() => {}); }, []);
  if (!o) return null;
  const ask = async (send) => { setMessage(''); try { setO((await send()).data); return true; } catch (err) { setMessage(errorMessage(err, "Couldn't do that")); return false; } };
  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    // The time zone of this device goes with it, so the calendar's times are said on your clock.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (await ask(() => axios.post('/api/calendar/others', { ...form, zone }))) setForm(null);
    setBusy(false);
  };
  const on = o.calendars.length > 0;
  return (
    <div className="py-3" id="other-calendars">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">🗓 Other calendars, on yours</h3>
        <span className={`rounded px-1.5 text-[11px] ${on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{on ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Shows a work calendar, or any calendar that has a link, beside your own. <span className="font-medium">What it does:</span> {o.service.sends}
      </p>
      {!o.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p> : (
        <div className="mt-2 space-y-2">
          {o.calendars.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-life-50">
              <span className="mr-auto">
                <span className="font-medium">{c.name}</span> <span className="text-xs text-gray-500 dark:text-life-300">{SHOW_WORDS[c.show]} · {c.events} in view{c.fetched_at ? ` · read ${new Date(c.fetched_at).toLocaleString()}` : ''}</span>
                {c.problem && <span className="block text-xs text-red-600">{c.problem}</span>}
              </span>
              <button type="button" onClick={() => ask(() => axios.put(`/api/calendar/others/${c.id}`, { name: c.name, show: c.show === 'busy' ? 'titles' : 'busy' }))} className={quietButtonClass}>{c.show === 'busy' ? 'Show what things are called' : 'Busy only'}</button>
              <button type="button" onClick={() => ask(() => axios.post(`/api/calendar/others/${c.id}/refresh`))} className={quietButtonClass}>Read again</button>
              <button type="button" onClick={() => { if (window.confirm(`Stop following ${c.name}? What was read from it, and its link, are forgotten.`)) ask(() => axios.delete(`/api/calendar/others/${c.id}`)); }} className={quietButtonClass}>Stop and forget</button>
            </div>
          ))}
          {!form ? <button type="button" onClick={() => { setForm({ name: '', url: '', show: 'busy' }); setMessage(''); }} className={quietButtonClass}>+ Follow a calendar</button> : (
            <form onSubmit={add} className="space-y-3 rounded-lg bg-life-50/60 p-3 dark:bg-life-800">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="What to call it *"><input required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Work" className={inputClass} /></Field>
                <Field label="Its link *"><input required type="password" autoComplete="off" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://… or webcal://…" className={inputClass} /></Field>
              </div>
              <fieldset className="space-y-1 text-sm text-gray-800 dark:text-life-50">
                <legend className="mb-1 font-medium">How much to show</legend>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="follow-show" checked={form.show === 'busy'} onChange={() => setForm({ ...form, show: 'busy' })} className="mt-1 accent-life-600" />
                  <span>Busy only <span className="block text-xs text-gray-500 dark:text-life-300">Just the times, under the name above. What each thing is called, where it is and its notes are never kept.</span></span>
                </label>
                <label className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="follow-show" checked={form.show === 'titles'} onChange={() => setForm({ ...form, show: 'titles' })} className="mt-1 accent-life-600" />
                  <span>What each thing is called <span className="block text-xs text-gray-500 dark:text-life-300">The times and the titles. Places and notes are still never kept.</span></span>
                </label>
              </fieldset>
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={() => setForm(null)} className={quietButtonClass}>Not now</button>
                <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Reading it…' : 'Read it and follow'}</button>
              </div>
              <p className="text-xs text-gray-500 dark:text-life-300">It's only saved if the link answers with a calendar. The link is stored locked and isn't shown again.</p>
            </form>
          )}
          {message && <p className="text-sm text-red-600">{message}</p>}
        </div>
      )}
    </div>
  );
}

function BookLookupService() {
  const [l, setL] = useState(null);
  useEffect(() => { axios.get('/api/lookups').then(({ data }) => setL(data)).catch(() => {}); }, []);
  if (!l) return null;
  const turn = async (books) => { const { data } = await axios.put('/api/lookups', { books }); setL(data); };
  const turnGroceries = async (groceries) => { const { data } = await axios.put('/api/lookups', { groceries }); setL(data); };
  const turnTitles = async (titles) => { const { data } = await axios.put('/api/lookups', { titles }); setL(data); };
  return (
    <>
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">🛒 Look up groceries when you scan them</h3>
        <span className={`rounded px-1.5 text-[11px] ${l.groceries ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{l.groceries ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Scan a package Life Is hasn't seen and its name is filled in for you to check, from <a href={l.grocery_service.site} target="_blank" rel="noreferrer" className="underline">{l.grocery_service.name}</a>.
        {' '}<span className="font-medium">What it's sent:</span> {l.grocery_service.sends} Scanning works without it; you just type the name yourself the first time.
      </p>
      {!l.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p>
        : <button type="button" onClick={() => turnGroceries(!l.groceries)} className={`${quietButtonClass} mt-2`}>{l.groceries ? 'Turn off' : 'Turn on'}</button>}
    </div>
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">📚 Look up books when you scan them</h3>
        <span className={`rounded px-1.5 text-[11px] ${l.books ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{l.books ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Scan a book you don't have yet and its title and author are filled in for you to check, from <a href={l.service.site} target="_blank" rel="noreferrer" className="underline">{l.service.name}</a>.
        {' '}<span className="font-medium">What it's sent:</span> {l.service.sends}
      </p>
      {!l.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p>
        : <button type="button" onClick={() => turn(!l.books)} className={`${quietButtonClass} mt-2`}>{l.books ? 'Turn off' : 'Turn on'}</button>}
    </div>
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">🎬 Look up films, music and games when you scan them</h3>
        <span className={`rounded px-1.5 text-[11px] ${l.titles ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{l.titles ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Scan a DVD, record or game you don't have yet and its title, and what it's on, are filled in for you to check, from{' '}
        {l.title_services.sites.map((s, i) => <span key={s.name}>{i > 0 && ' and '}<a href={s.site} target="_blank" rel="noreferrer" className="underline">{s.name}</a></span>)}.
        {' '}<span className="font-medium">What it's sent:</span> {l.title_services.sends}
      </p>
      {!l.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p>
        : <button type="button" onClick={() => turnTitles(!l.titles)} className={`${quietButtonClass} mt-2`}>{l.titles ? 'Turn off' : 'Turn on'}</button>}
    </div>
    </>
  );
}

function PhotoLibraryService() {
  const [l, setL] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { axios.get('/api/photos').then(({ data }) => setL(data)).catch(() => {}); }, []);
  if (!l) return null;
  const connect = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage('');
    try { const { data } = await axios.put('/api/photos', form); setL(data); setForm(null); } catch (err) { setMessage(errorMessage(err, "Couldn't connect it")); }
    setBusy(false);
  };
  const disconnect = async () => { const { data } = await axios.delete('/api/photos'); setL(data); };
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">🖼 Photos from your Immich, on plans and memories</h3>
        <span className={`rounded px-1.5 text-[11px] ${l.connected ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{l.connected ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Link photos from your own <a href={l.service.site} target="_blank" rel="noreferrer" className="underline">{l.service.name}</a> library to a plan, without copying them. <span className="font-medium">What it does:</span> {l.service.sends}
      </p>
      {!l.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p> : l.connected ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-life-50">
          <span className="mr-auto">Connected to <span className="font-medium">{l.url}</span></span>
          <button type="button" onClick={disconnect} className={quietButtonClass}>Disconnect and forget its key</button>
        </div>
      ) : !form ? <button type="button" onClick={() => { setForm({ url: '', key: '' }); setMessage(''); }} className={`${quietButtonClass} mt-2`}>Connect Immich</button> : (
        <form onSubmit={connect} className="mt-2 space-y-3 rounded-lg bg-life-50/60 p-3 dark:bg-life-800">
          <p className="text-sm text-gray-600 dark:text-life-100">{l.service.needs}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Immich's address *"><input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="http://192.168.1.20:2283" className={inputClass} /></Field>
            <Field label="API key *"><input required type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className={inputClass} /></Field>
          </div>
          {message && <p className="text-sm text-red-600">{message}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className={quietButtonClass}>Not now</button>
            <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Checking…' : 'Check and connect'}</button>
          </div>
        </form>
      )}
    </div>
  );
}
