import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import CopyButton, { CopyLine } from './Copy';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { addPasskey, guessDevice, passkeyCancelled, passkeyProblem } from './passkeys';

// Sign-in security, in Settings: a code from an authenticator app as a second step, recovery codes for the day
// the phone is gone, and passkeys. Every control is at least 44px tall, so a thumb can find it.
const tall = 'min-h-[44px]';
const input = `${inputClass} ${tall}`;
const solid = `${buttonClass} ${tall}`;
const quiet = `${quietButtonClass} ${tall}`;
const danger = `${quiet} !border-red-300 !text-red-700 dark:!text-red-300`;

const days = (day) => {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const Message = ({ message }) => message
  ? <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-red-600' : 'text-gray-700 dark:text-life-100'}`}>{message.error ?? message.ok}</p>
  : null;

/** Recovery codes, shown once: to copy or print before leaving. Life Is keeps only a scrambled form of each. */
function RecoveryCodes({ codes, onDone }) {
  return (
    <div className="space-y-3 rounded-xl border border-honey-400 bg-honey-100 p-4 dark:border-honey-500 dark:bg-life-900" data-recovery-codes>
      <p className="text-sm text-gray-800 dark:text-life-50"><strong>Save these recovery codes now.</strong> Each one works once, in place of a code from your app, if you lose your phone. Keep them somewhere safe, on paper or in a password manager. Life Is can't show them again.</p>
      <ul aria-label="Your recovery codes" className="grid grid-cols-1 gap-x-6 gap-y-1 font-mono text-sm text-gray-900 dark:text-life-50 min-[420px]:grid-cols-2">
        {codes.map((code) => <li key={code} className="select-all">{code}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={codes.join('\n')} what="the recovery codes" label="Copy all" />
        <button type="button" onClick={() => window.print()} className={quiet}>Print</button>
        <button type="button" onClick={onDone} className={solid}>I've saved them</button>
      </div>
    </div>
  );
}

function TwoStep({ status, reload, onCodes }) {
  const [step, setStep] = useState(null); // null | 'password' | 'app'
  const [action, setAction] = useState(null); // null | 'codes' | 'off'
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null);
  const [picture, setPicture] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const { on, recovery_left: left } = status.second_step;

  const run = async (work) => {
    setMessage(null);
    setBusy(true);
    try { await work(); } catch (err) { setMessage({ error: errorMessage(err, 'Something went wrong') }); } finally { setBusy(false); }
  };
  const reset = () => { setStep(null); setAction(null); setPassword(''); setCode(''); setSetup(null); setPicture(''); };

  // The QR code is drawn here, from the address in the page: nothing is asked of anything outside.
  useEffect(() => {
    if (!setup) return undefined;
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(setup.uri, { errorCorrectionLevel: 'M', margin: 1, width: 240 }))
      .then((url) => { if (!cancelled) setPicture(url); }).catch(() => {});
    return () => { cancelled = true; };
  }, [setup]);

  const start = (e) => { e.preventDefault(); run(async () => { const { data } = await axios.post('/api/security/second-step/start', { password }); setSetup(data); setPassword(''); setStep('app'); }); };
  const confirm = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await axios.post('/api/security/second-step/confirm', { setup: setup.setup, code });
      reset();
      onCodes(data.recovery_codes);
      setMessage({ ok: 'Two-step sign-in is on. Your other devices were signed out.' });
      await reload();
    });
  };
  const newCodes = (e) => { e.preventDefault(); run(async () => { const { data } = await axios.post('/api/security/recovery-codes', { password }); reset(); onCodes(data.recovery_codes); await reload(); }); };
  const turnOff = (e) => {
    e.preventDefault();
    run(async () => { await axios.post('/api/security/second-step/off', { password, code }); reset(); setMessage({ ok: 'Two-step sign-in is off. Your other devices were signed out.' }); await reload(); });
  };

  return (
    <div className="space-y-3" data-two-step>
      <h3 className="font-semibold text-life-800 dark:text-life-50">Two-step sign-in</h3>
      {!on && !step && (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">Off. When it's on, signing in needs your password and then a 6-digit code from an authenticator app on your phone (Aegis, 2FAS, Google Authenticator, a password manager), so a stolen password isn't enough.</p>
          <button type="button" onClick={() => setStep('password')} className={solid}>Set up two-step sign-in</button>
        </>
      )}
      {!on && step === 'password' && (
        <form onSubmit={start} className="space-y-3">
          <Field label="Your password, to start"><input type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></Field>
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={solid}>Continue</button><button type="button" onClick={reset} className={quiet}>Cancel</button></div>
        </form>
      )}
      {!on && step === 'app' && setup && (
        <form onSubmit={confirm} className="space-y-3">
          <p className="text-sm text-gray-700 dark:text-life-100">In your authenticator app, add an account and scan this code.</p>
          {picture
            ? <img src={picture} alt="QR code for your authenticator app" width="240" height="240" className="h-60 w-60 max-w-full rounded-lg border border-life-200 bg-card" />
            : <p className="text-sm text-gray-500 dark:text-life-200">Drawing the code…</p>}
          <p className="text-sm text-gray-700 dark:text-life-100">Can't scan it? Type this key into the app (it is shown only now):</p>
          <CopyLine text={setup.secret} what="the key for your authenticator app" />
          <Field label="Then the 6-digit code the app shows">
            <input required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} className={`${input} max-w-[12rem] text-center text-lg tracking-[0.3em]`} />
          </Field>
          <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={solid}>Turn on</button><button type="button" onClick={reset} className={quiet}>Cancel</button></div>
        </form>
      )}
      {on && (
        <>
          <p className="text-sm text-gray-700 dark:text-life-100">On. After your password, Life Is asks for the code from your authenticator app.</p>
          <p className={`rounded-lg px-3 py-2 text-sm ${left > 3 ? 'bg-life-50 text-gray-700 dark:bg-life-900 dark:text-life-100' : 'bg-honey-100 text-honey-700'}`} data-recovery-left>
            {left === 0 ? 'You have no recovery codes left. Make new ones, so losing your phone never locks you out.'
              : `${left} recovery ${left === 1 ? 'code' : 'codes'} left.${left <= 3 ? ' That is getting low: make new ones.' : ''}`}
          </p>
          {!action && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAction('codes')} className={quiet}>Make new recovery codes</button>
              <button type="button" onClick={() => setAction('off')} className={danger}>Turn two-step off</button>
            </div>
          )}
          {action === 'codes' && (
            <form onSubmit={newCodes} className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-life-100">The old codes will stop working.</p>
              <Field label="Your password"><input type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></Field>
              <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={solid}>Make new recovery codes</button><button type="button" onClick={reset} className={quiet}>Cancel</button></div>
            </form>
          )}
          {action === 'off' && (
            <form onSubmit={turnOff} className="space-y-3">
              <Field label="Your password"><input type="password" required autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></Field>
              <Field label="A code from your app, or a recovery code"><input required autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} maxLength={14} value={code} onChange={(e) => setCode(e.target.value)} className={input} /></Field>
              <div className="flex flex-wrap gap-2"><button type="submit" disabled={busy} className={danger}>Turn two-step off</button><button type="button" onClick={reset} className={quiet}>Cancel</button></div>
            </form>
          )}
        </>
      )}
      <Message message={message} />
    </div>
  );
}

function Passkeys({ status, reload }) {
  const problem = passkeyProblem();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [removing, setRemoving] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const add = async (e) => {
    e.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const saved = await addPasskey(password, name.trim() || guessDevice());
      setName(''); setPassword('');
      setMessage({ ok: `Added "${saved.name}". Next time, choose "Sign in with a passkey".` });
      await reload();
    } catch (err) {
      if (!passkeyCancelled(err)) setMessage({ error: errorMessage(err, "The passkey couldn't be added") });
    } finally { setBusy(false); }
  };
  const rename = async (e, key) => {
    e.preventDefault();
    try { await axios.put(`/api/security/passkeys/${key.id}`, { name: draft }); setRenaming(null); await reload(); } catch (err) { setMessage({ error: errorMessage(err, "That couldn't be renamed") }); }
  };
  const remove = async (key) => {
    try { await axios.delete(`/api/security/passkeys/${key.id}`); setRemoving(null); setMessage({ ok: `Removed "${key.name}". Delete it from that device's passkeys too.` }); await reload(); } catch (err) { setMessage({ error: errorMessage(err, "That couldn't be removed") }); }
  };

  return (
    <div className="space-y-3" data-passkeys>
      <h3 className="font-semibold text-life-800 dark:text-life-50">Passkeys</h3>
      <p className="text-sm text-gray-600 dark:text-life-100">A passkey signs you in with this device's own lock (face, fingerprint or PIN), with no password to type. It is already two things (the device, and you), so it skips the code. Each web address needs its own.</p>
      {status.passkeys.length > 0 && (
        <ul aria-label="Your passkeys" className="divide-y divide-life-100 dark:divide-life-700">
          {status.passkeys.map((key) => (
            <li key={key.id} className="space-y-2 py-3">
              {renaming === key.id ? (
                <form onSubmit={(e) => rename(e, key)} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-0 flex-1"><Field label="Passkey name"><input required autoFocus maxLength={60} value={draft} onChange={(e) => setDraft(e.target.value)} className={input} /></Field></div>
                  <button type="submit" className={solid}>Save</button>
                  <button type="button" onClick={() => setRenaming(null)} className={quiet}>Cancel</button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-gray-800 dark:text-life-50">{key.name}</p>
                    <p className="text-xs text-gray-500 dark:text-life-200">
                      Added {days(key.created_on)} · {key.last_used_on ? `last used ${days(key.last_used_on)}` : 'not used yet'}
                      {key.backed_up ? ' · synced to its owner\'s cloud' : ''}{key.here ? '' : ' · for another address'}
                    </p>
                    {key.flagged && <p className="text-xs text-red-600">Its counter went backwards, so it may have been copied. It is switched off: remove it, and add a fresh one.</p>}
                  </div>
                  <button type="button" onClick={() => { setRenaming(key.id); setDraft(key.name); setRemoving(null); }} aria-label={`Rename ${key.name}`} className={quiet}>Rename</button>
                  <button type="button" onClick={() => setRemoving(key.id)} aria-label={`Remove ${key.name}`} className={danger}>Remove</button>
                </div>
              )}
              {removing === key.id && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-honey-100 p-3 text-sm text-gray-800">
                  <span className="min-w-0 flex-1">Remove "{key.name}"? It can't be used to sign in again.</span>
                  <button type="button" onClick={() => remove(key)} className={danger}>Yes, remove it</button>
                  <button type="button" onClick={() => setRemoving(null)} className={quiet}>Keep it</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem ? (
        <p className="text-sm text-gray-700 dark:text-life-100" data-passkeys-unavailable>{problem}</p>
      ) : (
        <form onSubmit={add} className="space-y-3">
          <Field label="Name for this passkey"><input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={`For example: ${guessDevice()}`} className={input} /></Field>
          <Field label="Your password, to add one"><input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></Field>
          <button type="submit" disabled={busy} className={solid}>{busy ? 'Waiting for your device…' : 'Add a passkey on this device'}</button>
        </form>
      )}
      <Message message={message} />
    </div>
  );
}

/** The "Sign-in security" section of Settings. */
export function SignInSecurity() {
  const [status, setStatus] = useState(null);
  const [codes, setCodes] = useState(null);
  const reload = useCallback(async () => {
    try { const { data } = await axios.get('/api/security'); setStatus(data); } catch { setStatus((s) => s); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  if (!status) return <section className={cardClass} aria-busy="true"><h2 className="font-semibold text-life-800 dark:text-life-50">Sign-in security</h2></section>;
  if (status.demo) {
    return <section className={cardClass}><h2 className="font-semibold text-life-800 dark:text-life-50">Sign-in security</h2><p className="mt-2 text-sm text-gray-700 dark:text-life-100">Sign-in security can't be changed in the demo: everyone shares its account. In your own Life Is, you can turn on two-step sign-in and passkeys.</p></section>;
  }
  const dismiss = async () => { await axios.post('/api/security/notice/dismiss').catch(() => {}); reload(); };
  return (
    <section className={`${cardClass} space-y-6`} data-security>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Sign-in security</h2>
      {status.notice && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-honey-100 p-3 text-sm text-gray-800" role="status">
          <span className="min-w-0 flex-1">{status.notice}</span>
          <button type="button" onClick={dismiss} className={quiet}>Got it</button>
        </div>
      )}
      {codes && <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />}
      <TwoStep status={status} reload={reload} onCodes={setCodes} />
      <Passkeys status={status} reload={reload} />
    </section>
  );
}

/** For the admin, under "People": someone who has lost their phone can have their second step turned off. */
export function PeopleSignIn() {
  const [people, setPeople] = useState(null);
  const [asking, setAsking] = useState(null);
  const [message, setMessage] = useState(null);
  const load = useCallback(() => { axios.get('/api/security/people').then(({ data }) => setPeople(data)).catch(() => setPeople([])); }, []);
  useEffect(() => { load(); }, [load]);

  const reset = async (person) => {
    try {
      await axios.post(`/api/security/people/${person.id}/reset`);
      setAsking(null);
      setMessage({ ok: `${person.name ?? person.username}'s two-step sign-in is off and their passkeys are removed. They are signed out, and will be told next time they sign in.` });
      load();
    } catch (err) { setMessage({ error: errorMessage(err, "That couldn't be done") }); }
  };
  const others = (people ?? []).filter((p) => !p.you);
  if (!others.length) return null;
  return (
    <section className={`${cardClass} space-y-3`} data-people-security>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Someone locked out?</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">If someone has lost their phone and their recovery codes, you can turn off their two-step sign-in and remove their passkeys. They are signed out everywhere, and told what you did next time they sign in. You can't see anyone's codes.</p>
      <ul aria-label="People and their sign-in security" className="divide-y divide-life-100 dark:divide-life-700">
        {others.map((person) => (
          <li key={person.id} className="space-y-2 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium text-gray-800 dark:text-life-50">{person.name ?? person.username}</p>
                {person.name && person.name !== person.username && <p className="break-words text-xs text-gray-500 dark:text-life-200">Signs in as {person.username}</p>}
                <p className="text-xs text-gray-500 dark:text-life-200">{person.second_step ? 'Two-step sign-in is on' : 'Two-step sign-in is off'} · {person.passkeys === 0 ? 'no passkeys' : person.passkeys === 1 ? '1 passkey' : `${person.passkeys} passkeys`}</p>
              </div>
              <button type="button" disabled={!person.second_step && person.passkeys === 0} onClick={() => setAsking(person.id)} aria-label={`Turn off ${person.username}'s two-step sign-in and remove their passkeys`} className={`${danger} disabled:opacity-40`}>Turn off and remove</button>
            </div>
            {asking === person.id && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-honey-100 p-3 text-sm text-gray-800">
                <span className="min-w-0 flex-1">Turn off {person.name ?? person.username}'s two-step sign-in and remove their passkeys? Their password still works.</span>
                <button type="button" onClick={() => reset(person)} className={danger}>Yes, turn it off</button>
                <button type="button" onClick={() => setAsking(null)} className={quiet}>Keep it</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Message message={message} />
    </section>
  );
}
