import { useState } from 'react';
import { Field, inputClass, buttonClass, quietButtonClass } from '../components/ui';
import { findLifeIs, tidyAddress, unlocked } from './remote.js';

/**
 * The first thing the app asks, once: where this phone keeps Life Is. On the phone itself, or on a Life Is
 * the person hosts. It can be changed later in Settings; neither choice touches what the other holds.
 */
export default function Welcome({ onChosen }) {
  const [linking, setLinking] = useState(false);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let plain = false;
  try { plain = unlocked(tidyAddress(address)); } catch { /* not an address yet */ }

  const link = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const server = tidyAddress(address);
      await findLifeIs(server);
      await onChosen({ kind: 'server', address: server });
    } catch (problem) { setError(problem.message); setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-card/95 p-6 shadow-xl ring-1 ring-white/40 backdrop-blur dark:bg-life-900/90 dark:ring-life-700">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-full" />
          <div>
            <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Life Is</h1>
            <p className="text-xs text-gray-500 dark:text-life-200">Where should this phone keep it?</p>
          </div>
        </div>

        {!linking ? (
          <div className="space-y-3">
            <button type="button" onClick={() => onChosen({ kind: 'device' })} className="block w-full rounded-xl p-4 text-left ring-1 ring-life-100 hover:bg-life-50 dark:ring-life-700 dark:hover:bg-life-800">
              <span className="block font-medium text-life-800 dark:text-life-50">📱 On this phone</span>
              <span className="mt-1 block text-sm text-gray-600 dark:text-life-100">Everything stays here, locked with a key only this phone holds. No account, no password, and nothing sent anywhere.</span>
            </button>
            <button type="button" onClick={() => setLinking(true)} className="block w-full rounded-xl p-4 text-left ring-1 ring-life-100 hover:bg-life-50 dark:ring-life-700 dark:hover:bg-life-800">
              <span className="block font-medium text-life-800 dark:text-life-50">🏠 On a Life Is I host</span>
              <span className="mt-1 block text-sm text-gray-600 dark:text-life-100">You run Life Is on a computer of your own. This phone signs in to it and shows what it holds, the same as its web page does.</span>
            </button>
            <p className="text-xs text-gray-500 dark:text-life-300">You can change this later in Settings. Changing it moves nothing: what is on the phone stays on the phone, and what is on your server stays there.</p>
          </div>
        ) : (
          <form onSubmit={link} className="space-y-3">
            <Field label="The address of your Life Is">
              <input required autoFocus inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="lifeis.example.org  or  http://192.168.1.20:8020" className={inputClass} />
            </Field>
            <p className="text-xs text-gray-500 dark:text-life-300">The address you open it at in a browser. This phone will talk to that address and no other.</p>
            {plain && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">That address starts with http, not https, so what travels between this phone and it isn't locked. That's fine on your own home network. Don't use it over the internet or on someone else's Wi-Fi.</p>}
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => { setLinking(false); setError(''); }} className={quietButtonClass}>Back</button>
              <button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Looking for it…' : 'Connect'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
