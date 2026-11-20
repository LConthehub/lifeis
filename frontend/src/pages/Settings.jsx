import { useEffect, useState } from 'react';
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
