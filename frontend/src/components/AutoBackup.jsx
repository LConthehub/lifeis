import { useEffect, useState } from 'react';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';
import { noteCopyMade } from './YourFiles';

const touch = 'min-h-[44px]';
const pad = (n) => String(n).padStart(2, '0');
const dayName = (when) => `life-is-backup-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.lifeis`;

function ago(iso) {
  const then = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86400000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * On the device: a backup that makes itself each week (device/autoBackup.js). The passphrase is chosen once and
 * the phone remembers it; the file stays on the phone, and a copy goes somewhere else with one tap, no typing.
 */
export default function AutoBackup() {
  const [s, setS] = useState(null);
  const [asking, setAsking] = useState(false);
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [error, setError] = useState('');
  const auto = () => import('../device/autoBackup.js');
  const load = async () => setS(await (await auto()).autoBackupState());
  useEffect(() => { load().catch(() => {}); }, []);
  if (!s) return null;

  const run = async (what, work) => {
    setBusy(what); setError(''); setSaid('');
    try { await work(); } catch (err) { setError(errorMessage(err, err?.message || "That didn't work. Try again.")); }
    setBusy('');
  };
  const turnOn = (e) => {
    e.preventDefault();
    if (pass !== again) { setError("The two passphrases aren't the same"); return; }
    run('on', async () => {
      await (await auto()).turnOnAutoBackup(pass);
      setAsking(false); setPass(''); setAgain('');
      setSaid('Weekly backups are on, and the first one is made.');
      await load();
    });
  };
  const turnOff = () => run('off', async () => {
    await (await auto()).turnOffAutoBackup();
    setShown(null);
    setSaid('Weekly backups are off, and this phone has forgotten the passphrase. The backups already made are still on the phone.');
    await load();
  });
  const copyOut = () => run('copy', async () => {
    const bytes = await (await auto()).makeAutoBackup();
    const { handOver } = await import('../device/handOver.js');
    const name = dayName(new Date());
    await handOver(bytes, name);
    setSaid(`Made ${name}. Keep it wherever you like; without the passphrase it is unreadable.`);
    await noteCopyMade();
    await load();
  });
  const show = () => run('show', async () => setShown(shown === null ? await (await auto()).rememberedPassphrase() : null));

  return (
    <div className="mt-4 border-t border-life-100 pt-4 dark:border-life-700" data-auto-backup={s.on ? 'on' : 'off'}>
      <h3 className="font-semibold text-life-800 dark:text-life-50">A backup every week, by itself</h3>
      {!s.on && !asking && (
        <>
          <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Choose a passphrase once and this phone remembers it, locked away. Each week Life Is makes a fresh backup and puts it in this phone's Documents, in a folder called Life Is. Life Is sends it nowhere.</p>
          <div className="mt-3"><button type="button" onClick={() => { setAsking(true); setError(''); setSaid(''); }} className={`${buttonClass} ${touch}`}>Turn on weekly backups</button></div>
        </>
      )}
      {!s.on && asking && (
        <form onSubmit={turnOn} className="mt-2 space-y-3">
          <Field label="A passphrase for your weekly backups"><input type="password" required minLength={8} autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} className={inputClass} /></Field>
          <Field label="The same passphrase once more"><input type="password" required minLength={8} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={inputClass} /></Field>
          <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">Write the passphrase down somewhere safe. A new phone will ask for it, and nobody, including whoever made Life Is, can open a backup without it.</p>
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setAsking(false)} className={`${quietButtonClass} ${touch}`}>Cancel</button><button type="submit" disabled={busy === 'on'} className={`${buttonClass} ${touch}`}>{busy === 'on' ? 'Making the first one…' : 'Turn on'}</button></div>
        </form>
      )}
      {s.on && (
        <>
          <p className="mt-1 text-sm text-gray-800 dark:text-life-50" data-auto-last>On. Last one made {s.last ? ago(s.last) : 'not yet'}{s.where === 'documents' ? ', in Documents, in the folder Life Is' : s.where === 'app' ? ", in the app's own storage on this phone" : ''}. The newest two are kept.</p>
          {s.problem && <p className="mt-1 text-sm text-red-600" role="alert">The last try didn't work: {s.problem}</p>}
          <p className="mt-2 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">These stay on this phone, so they are lost if the phone is. Save a copy somewhere else now and then: it takes one tap, with nothing to type.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copyOut} disabled={busy === 'copy'} className={`${buttonClass} ${touch}`}>{busy === 'copy' ? 'Locking it…' : 'Save a copy somewhere else'}</button>
            <button type="button" onClick={show} className={`${quietButtonClass} ${touch}`}>{shown === null ? 'Show the passphrase' : 'Hide the passphrase'}</button>
            <button type="button" onClick={turnOff} disabled={busy === 'off'} className={`${quietButtonClass} ${touch}`}>Turn off</button>
          </div>
          {shown !== null && <p className="mt-2 break-all rounded-lg bg-life-50 px-3 py-2 font-mono text-sm text-life-800 dark:bg-life-800 dark:text-life-50" data-auto-passphrase>{shown}</p>}
        </>
      )}
      {said && <p className="mt-2 break-words rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-800 dark:text-life-50" role="status">{said}</p>}
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
