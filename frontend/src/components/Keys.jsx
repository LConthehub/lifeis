import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { CopyLine } from './Copy';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';
import { onDevice, serverOrigin } from '../where';

// Personal keys, in Settings: a named key for a voice shortcut (Siri Shortcuts), good for a short list of things.
// Off until one is made. The key is shown once, when it is made; Life Is keeps only a scrambled form of it.
const tall = 'min-h-[44px]';
const input = `${inputClass} ${tall}`;
const solid = `${buttonClass} ${tall}`;
const quiet = `${quietButtonClass} ${tall}`;
const danger = `${quiet} !border-red-300 !text-red-700 dark:!text-red-300`;

const dayText = (day) => {
  if (!day) return 'Never used';
  const [y, m, d] = day.split('-').map(Number);
  return `Last used ${new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
};

export function PersonalKeys() {
  const [state, setState] = useState(null);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [can, setCan] = useState([]);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(null); // the key just made: { key, made }
  const [removing, setRemoving] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setState((await axios.get('/api/keys')).data); } catch (err) { setMessage({ error: errorMessage(err, "The keys couldn't be read") }); }
  }, []);
  useEffect(() => { if (!onDevice()) reload(); }, [reload]);

  const run = async (work) => {
    setMessage(null);
    setBusy(true);
    try { await work(); } catch (err) { setMessage({ error: errorMessage(err, "That didn't work. Try again in a moment.") }); } finally { setBusy(false); }
  };

  if (onDevice()) {
    return (
      <section className={cardClass} data-keys>
        <h2 className="font-semibold text-life-800 dark:text-life-50">Personal keys</h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-life-100">Keys work only on a Life Is you run on a computer, where a shortcut on your phone can reach it. This phone keeps your Life Is on the phone itself, so there is nothing for a key to open.</p>
      </section>
    );
  }

  const start = () => { setMaking(true); setMessage(null); setCan(state.actions.map((a) => a.id)); };
  const reset = () => { setMaking(false); setName(''); setCan([]); setPassword(''); };
  const make = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await axios.post('/api/keys', { name, can, password });
      setState(data);
      setShown({ key: data.key, made: data.made });
      reset();
    });
  };
  const turn = (key, on) => run(async () => { setState((await axios.put(`/api/keys/${key.id}`, { on })).data); });
  const remove = (key) => run(async () => {
    setState((await axios.delete(`/api/keys/${key.id}`)).data);
    setRemoving(null);
    setMessage({ ok: `Deleted "${key.name}". It stops working at once. Delete the shortcut that used it too.` });
  });
  const toggle = (id) => setCan((now) => (now.includes(id) ? now.filter((x) => x !== id) : [...now, id]));

  const origin = serverOrigin();
  const secure = origin.startsWith('https://');

  return (
    <section className={`${cardClass} space-y-3`} data-keys>
      <h2 className="font-semibold text-life-800 dark:text-life-50">Personal keys</h2>
      <p className="text-sm text-gray-600 dark:text-life-100">
        A key lets one shortcut, like Siri on your iPhone, do a few things in your Life Is without signing in. It sees only what you can see and never reaches guns or ammunition, measures, hidden gifts, money or mail. Nothing is turned on until you make a key. The guide called "Siri and Shortcuts" on the Life Is website says how to build the shortcuts.
      </p>

      {shown && (
        <div className="space-y-3 rounded-xl border border-honey-400 bg-honey-100 p-4 dark:border-honey-500 dark:bg-life-900" data-new-key>
          <p className="text-sm text-gray-800 dark:text-life-50"><strong>Copy "{shown.made.name}" now.</strong> This is the only time Life Is shows it. It keeps only a scrambled form, so it can't show it again. If it is lost, make a new key.</p>
          <CopyLine text={shown.key} what="the key" />
          <div className="space-y-1 text-sm text-gray-800 dark:text-life-50">
            <p>Your shortcuts use this address:</p>
            <CopyLine text={`${origin}/api/voice/`} what="the address" />
            {!secure && <p role="note" className="text-xs text-gray-700 dark:text-life-200">This address doesn't start with https://. Your phone can reach Life Is from outside your home only through an https:// address.</p>}
          </div>
          <button type="button" onClick={() => setShown(null)} className={solid}>I've copied it</button>
        </div>
      )}

      {state && state.keys.length === 0 && !making && !shown && <p className="text-sm text-gray-700 dark:text-life-100">You have no keys. Keys are off until you make one.</p>}

      {state && state.keys.length > 0 && (
        <ul className="space-y-3" aria-label="Your keys">
          {state.keys.map((key) => (
            <li key={key.id} className="space-y-2 rounded-xl border border-life-100 p-3 dark:border-life-700" data-key={key.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-medium text-gray-900 dark:text-life-50">{key.name}</span>
                <span className={`text-xs font-semibold ${key.on ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-life-200'}`}>{key.on ? 'On' : 'Off'}</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-life-200">Ends in <span className="font-mono">{key.hint}</span> · {dayText(key.last_used_on)}</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700 dark:text-life-100" aria-label={`What ${key.name} can do`}>
                {key.says.map((says) => <li key={says}>{says}</li>)}
              </ul>
              {removing === key.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-800 dark:text-life-50">Delete "{key.name}" for good?</span>
                  <button type="button" disabled={busy} onClick={() => remove(key)} className={danger}>Yes, delete it</button>
                  <button type="button" onClick={() => setRemoving(null)} className={quiet}>Keep it</button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => turn(key, !key.on)} className={quiet} aria-label={`${key.on ? 'Turn off' : 'Turn on'} ${key.name}`}>{key.on ? 'Turn off' : 'Turn on'}</button>
                  <button type="button" onClick={() => setRemoving(key.id)} className={danger} aria-label={`Delete ${key.name}`}>Delete</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {state && !making && (
        state.keys.length >= state.most
          ? <p className="text-sm text-gray-700 dark:text-life-100">That is {state.most} keys. Delete one you don't use to make another.</p>
          : <button type="button" onClick={start} className={solid}>Make a key</button>
      )}

      {state && making && (
        <form onSubmit={make} className="space-y-3 rounded-xl border border-life-100 p-3 dark:border-life-700" aria-label="Make a key">
          <Field label="What is it for? (a name)">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Siri on my iPhone" className={input} required />
          </Field>
          <fieldset className="space-y-1">
            <legend className="text-xs font-medium text-gray-600 dark:text-life-200">What it may do</legend>
            {state.actions.map((a) => (
              <label key={a.id} className="flex min-h-[44px] items-center gap-3 text-sm text-gray-800 dark:text-life-50">
                <input type="checkbox" checked={can.includes(a.id)} onChange={() => toggle(a.id)} className="h-5 w-5" />
                {a.says}
              </label>
            ))}
          </fieldset>
          <Field label="Your password, to make it">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className={input} required />
          </Field>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !name.trim() || can.length === 0 || !password} className={solid}>Make the key</button>
            <button type="button" onClick={reset} className={quiet}>Cancel</button>
          </div>
        </form>
      )}

      {message && <p role={message.error ? 'alert' : 'status'} className={`text-sm ${message.error ? 'text-red-600' : 'text-gray-700 dark:text-life-100'}`}>{message.error ?? message.ok}</p>}
    </section>
  );
}
