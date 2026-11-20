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
