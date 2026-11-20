import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { LifeAreasPicker } from '../components/LifeAreas';

const IDLE_TEXT = { 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', 120: '2 hours', 480: '8 hours', 0: 'Stay signed in' };

export default function Settings({ user, onLogout, onLifeChanged }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Settings</h1>
      <section className={cardClass}>
        <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">What Life Is looks after</h2>
        <LifeAreasPicker onSaved={onLifeChanged} />
      </section>
      <OutsideServices />
      <SignedOut />
      <PasswordForm />
      {user.is_admin && <AddPerson />}
      <section className={cardClass}>
        <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Your recipes, yours to take</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-life-100">
          Download every recipe as Nextcloud Cookbook folders (each one a <code>recipe.json</code>, with the original text beside it).
          Unzip them into the Recipes folder in your Nextcloud and the Cookbook app shows them.
        </p>
        <a href="/api/kitchen/recipes-export.zip" className={quietButtonClass}>Download recipes</a>
      </section>
      <button type="button" onClick={onLogout} className={quietButtonClass}>Sign out ({user.username})</button>
    </div>
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

/** Everything that reaches outside this computer, in one place. Each is off until turned on, and says what it sends. */
function OutsideServices() {
  return (
    <section className={cardClass}>
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Outside services</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-life-100">
        Life Is keeps what you write on this computer and works without any of these. Each one is off until you turn it on,
        says exactly what it sends, and can be turned off again. This list is all of them.
      </p>
      <div className="divide-y divide-life-100 dark:divide-life-700">
        <WeatherService />
        <MailService />
        <BookLookupService />
        <div className="py-3">
          <h3 className="font-medium text-gray-800 dark:text-life-50">📺 Your Jellyfin or Emby</h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Brings the films, shows, music and books on a media server you name into your collection. Life Is only reads from that server, using the key you give it, and talks to nowhere else.</p>
          <Link to="/media/servers" className="mt-2 inline-block text-sm text-life-600 hover:underline dark:text-life-200">Media servers →</Link>
        </div>
      </div>
    </section>
  );
}

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

function BookLookupService() {
  const [l, setL] = useState(null);
  useEffect(() => { axios.get('/api/lookups').then(({ data }) => setL(data)).catch(() => {}); }, []);
  if (!l) return null;
  const turn = async (books) => { const { data } = await axios.put('/api/lookups', { books }); setL(data); };
  return (
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
  );
}
