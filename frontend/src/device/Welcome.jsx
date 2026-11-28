import { useEffect, useState } from 'react';
import { Field, inputClass, buttonClass, quietButtonClass } from '../components/ui';
import Icon from '../components/Icon';
import { findLifeIs, tidyAddress, unlocked } from './remote.js';

const quietLink = 'min-h-[44px] text-sm text-life-700 underline dark:text-life-200';

/**
 * The first thing the app shows, once. Most people press Start and keep Life Is on the phone. Someone with a
 * backup from another phone brings it back here, and someone who hosts their own Life Is links to it from the
 * small line underneath. It can be changed later in Settings; neither choice touches what the other holds.
 *
 * `onBringBack(file, passphrase, sure)` puts a backup on this phone. It answers `{ holds: true }`, changing
 * nothing, when the phone already holds a Life Is and `sure` was not given.
 *
 * `findCarried()` answers the backup this phone's own backup brought across from an old phone, if there is one
 * (`{ file, made }`). Then the first thing offered is to bring that one back: only its passphrase is asked.
 */
const madeOn = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric' }) : null);

export default function Welcome({ onChosen, onBringBack, findCarried }) {
  const [view, setView] = useState('start'); // 'start' | 'backup' | 'server'
  const [address, setAddress] = useState('');
  const [file, setFile] = useState(null);
  const [pass, setPass] = useState('');
  const [holds, setHolds] = useState(false);
  const [carried, setCarried] = useState(null);
  useEffect(() => { findCarried?.().then((found) => { if (found) setCarried(found); }).catch(() => {}); }, []);
  const using = carried && !file;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  let plain = false;
  try { plain = unlocked(tidyAddress(address)); } catch { /* not an address yet */ }
  const show = (next) => { setView(next); setError(''); setHolds(false); setPass(''); setFile(null); };

  const link = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const server = tidyAddress(address);
      await findLifeIs(server);
      await onChosen({ kind: 'server', address: server });
    } catch (problem) { setError(problem.message); setBusy(false); }
  };

  const bringBack = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const done = await onBringBack(file ?? carried.file, pass, holds, !file);
      if (done?.holds) { setHolds(true); setBusy(false); }
    } catch (problem) { setError(problem?.response?.data?.detail ?? problem.message ?? "Couldn't bring that backup back"); setBusy(false); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md space-y-4 rounded-2xl bg-card/95 p-6 shadow-xl ring-1 ring-white/40 backdrop-blur dark:bg-life-900/90 dark:ring-life-700">
        <div className="flex items-center gap-3">
          <img src="/mark-tan-192.png" alt="" className="h-12 w-12 dark:hidden" /><img src="/mark-192.png" alt="" className="hidden h-12 w-12 dark:block" />
          <div>
            <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Life Is</h1>
            <p className="text-xs text-gray-500 dark:text-life-200">{view === 'backup' ? 'Bring a backup back' : view === 'server' ? 'A Life Is you host' : 'Your home, kept on your phone'}</p>
          </div>
        </div>

        {view === 'start' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-life-100">Everything stays on this phone, locked with a key only this phone holds. No account, no password, and nothing sent anywhere.</p>
            {carried && (
              <div className="space-y-2 rounded-xl bg-life-50 p-3 dark:bg-life-800" data-carried>
                <p className="text-sm text-life-800 dark:text-life-50">Your Life Is backup{madeOn(carried.made) ? ` from ${madeOn(carried.made)}` : ''} came across with this phone's own backup.</p>
                <button type="button" onClick={() => show('backup')} className={`${buttonClass} min-h-[48px] w-full justify-center text-base`}>Bring it back</button>
              </div>
            )}
            <button type="button" onClick={() => onChosen({ kind: 'device' })} className={`${carried ? quietButtonClass : `${buttonClass} text-base`} min-h-[48px] w-full justify-center`}><Icon of="phone" /> {carried ? 'Start fresh on this phone' : 'Start on this phone'}</button>
            {!carried && <button type="button" onClick={() => show('backup')} className={`${quietButtonClass} min-h-[48px] w-full justify-center`}>I have a backup</button>}
            <div className="text-center"><button type="button" onClick={() => show('server')} className={quietLink}>I host my own Life Is</button></div>
          </div>
        )}

        {view === 'backup' && (
          <form onSubmit={bringBack} className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-life-100">{carried ? `Type the passphrase you chose for your weekly backups. The backup${madeOn(carried.made) ? ` from ${madeOn(carried.made)}` : ''} is already on this phone. It is opened here and sent nowhere.` : 'Choose the backup file you saved from your other phone (its name ends in .lifeis) and type its passphrase. It is opened here and sent nowhere.'}</p>
            <Field label={carried ? 'A different backup file (only if you want another one)' : 'The backup file'}><input type="file" required={!carried} onChange={(e) => { setFile(e.target.files[0] ?? null); setHolds(false); }} className="block min-h-[44px] w-full text-sm file:mr-3 file:min-h-[44px] file:rounded-lg file:border file:border-life-200 file:bg-card file:px-3 file:text-sm file:text-life-700" /></Field>
            <Field label="Its passphrase"><input type="password" required autoComplete="off" value={pass} onChange={(e) => setPass(e.target.value)} className={inputClass} /></Field>
            {holds && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700" role="alert">This phone already holds a Life Is. Bringing the backup back replaces it: what is here now, and isn't in the backup, will be gone.</p>}
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => show('start')} className={`${quietButtonClass} min-h-[44px]`}>Back</button>
              <button type="submit" disabled={busy || (!file && !using)} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Bringing it back…' : holds ? 'Replace what is here' : 'Bring it back'}</button>
            </div>
          </form>
        )}

        {view === 'server' && (
          <form onSubmit={link} className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-life-100">You run Life Is on a computer of your own. This phone signs in to it and shows what it holds, the same as its web page does.</p>
            <Field label="The address of your Life Is">
              <input required autoFocus inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="lifeis.example.org  or  http://192.168.1.20:8020" className={inputClass} />
            </Field>
            <p className="text-xs text-gray-500 dark:text-life-300">The address you open it at in a browser. This phone will talk to that address and no other.</p>
            {plain && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">That address starts with http, not https, so what travels between this phone and it isn't locked. That's fine on your own home network. Don't use it over the internet or on someone else's Wi-Fi.</p>}
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <div className="flex justify-between gap-2">
              <button type="button" onClick={() => show('start')} className={`${quietButtonClass} min-h-[44px]`}>Back</button>
              <button type="submit" disabled={busy} className={`${buttonClass} min-h-[44px]`}>{busy ? 'Looking for it…' : 'Connect'}</button>
            </div>
          </form>
        )}

        {view !== 'backup' && <p className="text-xs text-gray-500 dark:text-life-300">You can change this later in Settings. Changing it moves nothing: what is on the phone stays on the phone, and what is on your server stays there.</p>}
      </div>
    </div>
  );
}
