import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, errorMessage } from '../components/ui';
import { chooseAgain, linkedServer } from '../where';

export default function Login({ setupRequired, local = true, offline, onDone }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await axios.post(setupRequired ? '/api/auth/setup' : '/api/auth/login', form);
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't sign in"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white/95 p-6 shadow-xl ring-1 ring-white/40 backdrop-blur dark:bg-life-900/90 dark:ring-life-700">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
          <div>
            <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Life Is</h1>
            <p className="text-xs text-gray-500 dark:text-life-200">{setupRequired ? 'Make your account. It stays on this computer.' : 'Sign in to your home.'}</p>
          </div>
        </div>
        {setupRequired && !local && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Nobody has signed up yet. The first account can only be made on the computer Life Is runs on.</p>}
        {offline && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Life Is isn't answering. Is it running?</p>}
        <Field label="Username"><input autoFocus autoComplete="username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={inputClass} /></Field>
        <Field label="Password"><input type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 12 : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={inputClass} /></Field>
        {setupRequired && <p className="text-xs text-gray-500 dark:text-life-200">At least 12 characters. Write it down somewhere safe: nobody can reset it for you.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`${buttonClass} w-full`}>{setupRequired ? 'Make my account' : 'Sign in'}</button>
        {linkedServer() && <p className="text-center text-xs text-gray-500 dark:text-life-200">At <span className="break-all">{linkedServer()}</span>. <button type="button" onClick={chooseAgain} className="underline">Use a different one</button></p>}
      </form>
    </div>
  );
}
