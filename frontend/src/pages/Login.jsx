import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, buttonClass, errorMessage } from '../components/ui';
import { passkeyCancelled, passkeysUsable, secondStepWithPasskey, signInWithPasskey } from '../components/passkeys';
import { chooseAgain, linkedServer } from '../where';

const tall = 'min-h-[44px]';
const input = `${inputClass} ${tall}`;
const solid = `${buttonClass} ${tall}`;
const link = `${tall} rounded-lg px-2 text-sm text-life-700 underline dark:text-life-100`;

export default function Login({ setupRequired, local = true, offline, demo = null, onDone }) {
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // After the right password, when two-step is on: { pending, passkey } until the code is typed.
  const [second, setSecond] = useState(null);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  // Something an admin did that the person should read before going on (their two-step was turned off).
  const [notice, setNotice] = useState('');

  const finished = (data) => {
    if (data?.notice) { setSecond(null); setNotice(data.notice); return; }
    onDone();
  };
  const back = (message = '') => { setSecond(null); setCode(''); setRecovery(false); setForm((f) => ({ ...f, password: '' })); setError(message); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post(setupRequired ? '/api/auth/setup' : '/api/auth/login', form);
      if (data?.second_step) { setSecond({ pending: data.pending, passkey: Boolean(data.passkey) }); setCode(''); setRecovery(false); } else finished(data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't sign in"));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await axios.post('/api/auth/second-step', { pending: second.pending, code });
      finished(data);
    } catch (err) {
      const said = errorMessage(err, "That code didn't work");
      // The sign-in ran out, or ended after too many wrong tries: back to the password.
      if (err?.response?.status === 400 || /Too many wrong tries|Too many failed/.test(said)) back(said); else { setError(said); setCode(''); }
    } finally {
      setBusy(false);
    }
  };

  const usePasskey = async (second_step) => {
    setBusy(true);
    setError('');
    try {
      finished(second_step ? await secondStepWithPasskey(second.pending) : await signInWithPasskey());
    } catch (err) {
      if (!passkeyCancelled(err)) {
        const said = errorMessage(err, "The passkey didn't work");
        if (second_step && err?.response?.status === 400) back(said); else setError(said);
      }
    } finally {
      setBusy(false);
    }
  };

  // A demo's sign-in is the same for everyone, so it's one tap.
  const enterDemo = async () => {
    setBusy(true); setError('');
    try { await axios.post('/api/auth/login', demo); onDone(); } catch (err) { setError(errorMessage(err, "The demo couldn't be opened")); } finally { setBusy(false); }
  };
  const wrapper = 'w-full max-w-sm space-y-4 rounded-2xl bg-white/95 p-6 shadow-xl ring-1 ring-white/40 backdrop-blur dark:bg-life-900/90 dark:ring-life-700';
  const heading = (words) => (
    <div className="flex items-center gap-3">
      <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
      <div>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Life Is</h1>
        <p className="text-xs text-gray-500 dark:text-life-200">{words}</p>
      </div>
    </div>
  );

  if (notice) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className={wrapper}>
          {heading('You are signed in.')}
          <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-gray-800" role="status">{notice}</p>
          <button type="button" className={`${solid} w-full`} onClick={() => { axios.post('/api/security/notice/dismiss').catch(() => {}).finally(onDone); }}>Continue</button>
        </div>
      </div>
    );
  }

  if (second) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <form onSubmit={sendCode} className={wrapper} data-second-step>
          {heading(recovery ? 'Use a recovery code' : 'One more step')}
          {recovery ? (
            <>
              <p className="text-sm text-gray-700 dark:text-life-100">Type one of the recovery codes you saved. Each one works once.</p>
              <Field label="Recovery code"><input key="recovery" autoFocus required autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={14} value={code} onChange={(e) => setCode(e.target.value)} className={`${input} text-center font-mono text-lg tracking-widest`} /></Field>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-700 dark:text-life-100">Open your authenticator app and type the 6-digit code it shows for Life Is.</p>
              <Field label="6-digit code"><input key="code" autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className={`${input} text-center text-2xl tracking-[0.4em]`} /></Field>
            </>
          )}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className={`${solid} w-full`}>Sign in</button>
          <div className="flex flex-col items-start gap-1">
            <button type="button" className={link} onClick={() => { setRecovery(!recovery); setCode(''); setError(''); }}>{recovery ? 'Use a code from my app instead' : 'Use a recovery code instead'}</button>
            {second.passkey && passkeysUsable() && <button type="button" disabled={busy} className={link} onClick={() => usePasskey(true)}>Use a passkey instead</button>}
            <button type="button" className={link} onClick={() => back()}>Back</button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className={wrapper}>
        {heading(setupRequired ? 'Make your account. It stays on this computer.' : 'Sign in to your home.')}
        {setupRequired && !local && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Nobody has signed up yet. The first account can only be made on the computer Life Is runs on.</p>}
        {demo && !setupRequired && (
          <div className="space-y-2 rounded-xl bg-life-50 p-3 dark:bg-life-800" data-demo>
            <p className="text-sm text-gray-700 dark:text-life-100">This is a demo: a made-up household you can look around and change. Everything is reset each night.</p>
            <button type="button" onClick={enterDemo} disabled={busy} className={`${solid} w-full`}>Try the demo</button>
            <p className="text-center text-xs text-gray-500 dark:text-life-300">or sign in below as <span className="font-mono">{demo.username}</span></p>
          </div>
        )}
        {offline && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Life Is isn't answering. Is it running?</p>}
        <Field label="Username"><input autoFocus={!demo} autoComplete="username" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className={input} /></Field>
        <Field label="Password"><input type="password" autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 12 : undefined} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input} /></Field>
        {setupRequired && <p className="text-xs text-gray-500 dark:text-life-200">At least 12 characters. Write it down somewhere safe: nobody can reset it for you.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={`${solid} w-full`}>{setupRequired ? 'Make my account' : 'Sign in'}</button>
        {!setupRequired && !demo && passkeysUsable() && (
          <button type="button" disabled={busy} onClick={() => usePasskey(false)} className={`${tall} w-full rounded-full border border-life-300 px-4 py-2 text-sm font-medium text-life-700 hover:bg-life-50 disabled:opacity-50 dark:border-life-600 dark:text-life-100 dark:hover:bg-life-800`}>Sign in with a passkey</button>
        )}
        {linkedServer() && <p className="text-center text-xs text-gray-500 dark:text-life-200">At <span className="break-all">{linkedServer()}</span>. <button type="button" onClick={chooseAgain} className="underline">Use a different one</button></p>}
      </form>
    </div>
  );
}
