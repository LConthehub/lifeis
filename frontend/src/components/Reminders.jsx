import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { inputClass, quietButtonClass, errorMessage } from './ui';
import { inApp, onDevice } from '../where';
import { CopyLine } from './Copy';

const COVERS = [['upkeep', '🔧 Upkeep due'], ['low', '📦 Running low, or food to use soon'], ['dates', '🎂 Birthdays, plans and today’s events'], ['coupons', '🏷 Coupons running out, things lent a long time'], ['copy', '💾 A reminder to make a copy']];
const zone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; } };
const bytesOf = (base64) => {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};
const browserName = () => {
  const ua = navigator.userAgent;
  const what = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const where = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : null;
  return where ? `${what} on ${where}` : what;
};

/** Settings → Reminders: a morning digest, what it covers, when, and each way it can reach you. */
export function RemindersSettings() {
  const [state, setState] = useState(null);
  const [preview, setPreview] = useState(null);
  const [said, setSaid] = useState({});           // a sentence under each way, after trying or turning it on
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    axios.get('/api/reminders').then(({ data }) => setState(data)).catch(() => setState(false));
    axios.get('/api/reminders/digest').then(({ data }) => setPreview(data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  if (state === null) return null;
  if (state === false) return <p className="py-3 text-sm text-gray-500 dark:text-life-300">Reminders couldn't be read just now.</p>;
  const s = state.settings;

  const save = async (change, which) => {
    setBusy(which ?? 'save');
    // Shown at once (a box ticks when it's tapped); what Life Is kept replaces it when it answers.
    const before = state;
    setState({ ...state, settings: { ...state.settings, ...change, covers: { ...state.settings.covers, ...(change.covers ?? {}) } } });
    try { setState((await axios.put('/api/reminders', { ...change, zone: zone() })).data); }
    catch (err) { setState(before); setSaid((x) => ({ ...x, [which ?? 'save']: errorMessage(err, "Couldn't save that") })); }
    setBusy('');
  };
  const tryIt = async (channel) => {
    setBusy(channel);
    try {
      const { data } = await axios.post('/api/reminders/try', { channel });
      setSaid((x) => ({ ...x, [channel]: data.sent.includes(channel) ? 'Sent. It should arrive in a moment.' : data.problems.join(' ') }));
    } catch (err) { setSaid((x) => ({ ...x, [channel]: errorMessage(err, "Couldn't send it") })); }
    setBusy('');
  };
  const allowHere = async () => {
    setBusy('push');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser can’t receive notifications from a website.');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('The browser was told no. To change that, allow notifications for this site in its settings.');
      const worker = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await worker.pushManager.getSubscription()) ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytesOf(state.push_key) });
      const json = sub.toJSON();
      await axios.post('/api/reminders/browsers', { endpoint: json.endpoint, keys: json.keys, label: browserName() });
      setState((await axios.put('/api/reminders', { push: true, zone: zone() })).data);
      setSaid((x) => ({ ...x, push: 'This browser will get them.' }));
    } catch (err) { setSaid((x) => ({ ...x, push: err?.response ? errorMessage(err, "Couldn't turn them on") : err.message })); }
    setBusy('');
  };
  const forget = async (endpoint) => { setState((await axios.delete('/api/reminders/browsers', { params: { endpoint } })).data); };
  const anyOn = s.email || s.ntfy || s.push || s.phone;

  return (
    <div className="space-y-4 py-3" data-reminders>
      <p className="text-sm text-gray-600 dark:text-life-100">
        Each morning, what needs you: upkeep due, things running low, today’s dates. It only goes the ways you turn on below, and only on days there’s something to say.
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
        <label className="flex items-center gap-2">Each morning at
          <input type="time" value={s.time} onChange={(e) => e.target.value && save({ time: e.target.value })} aria-label="When" className={`${inputClass} !w-32`} />
        </label>
        <span className="text-xs text-gray-500 dark:text-life-300">{s.zone ?? zone() ?? ''}</span>
      </div>
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-life-200">What it covers</legend>
        {COVERS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <input type="checkbox" checked={s.covers[key]} onChange={(e) => save({ covers: { [key]: e.target.checked } })} className="accent-life-600" /> {label}
          </label>
        ))}
      </fieldset>
      {preview && (
        <details className="rounded-lg bg-life-50 p-3 text-sm dark:bg-life-700" data-preview>
          <summary className="cursor-pointer text-gray-700 dark:text-life-100">What it would say this morning: {preview.title.toLowerCase()}</summary>
          {preview.lines.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {preview.lines.map((l, i) => <li key={i}><Link to={l.link} className="hover:underline">{l.icon} {l.title}</Link>{l.detail && <span className="text-xs text-gray-500 dark:text-life-300"> · {l.detail}</span>}</li>)}
            </ul>
          )}
        </details>
      )}

      <div className="divide-y divide-life-50 dark:divide-life-700">
        {inApp() && (
          <Way icon="📱" title="On this phone" on={s.phone} said={said.phone}
            sends="Made on this phone from what’s kept on it, at your time each morning. Nothing leaves the phone."
            actions={<button type="button" disabled={busy === 'phone'} onClick={async () => { await save({ phone: !s.phone }, 'phone'); window.dispatchEvent(new Event('lifeis-reminders')); }} className={quietButtonClass}>{s.phone ? 'Turn off' : 'Turn on'}</button>} />
        )}
        {!onDevice() && state.can.mail_available && (
          <Way icon="✉️" title={state.services.email.name} on={s.email} said={said.email} sends={state.services.email.sends}
            actions={state.can.email ? (
              <>
                <button type="button" disabled={busy === 'email'} onClick={() => save({ email: !s.email }, 'email')} className={quietButtonClass}>{s.email ? 'Turn off' : 'Turn on'}</button>
                <button type="button" disabled={busy === 'email'} onClick={() => tryIt('email')} className={quietButtonClass}>Send one now</button>
              </>
            ) : <Link to="/settings/connections#mail" className="text-sm text-life-600 underline dark:text-life-200">Connect your email first</Link>} />
        )}
        {!onDevice() && state.can.push && (
          <Way icon="🔔" title="This browser, and others you allow" on={s.push} said={said.push} sends={state.services.push.sends}
            actions={!window.isSecureContext ? <span className="text-sm text-gray-500 dark:text-life-300">Open Life Is at its https address to allow these.</span> : (
              <>
                <button type="button" disabled={busy === 'push'} onClick={allowHere} className={quietButtonClass}>Allow on this browser</button>
                {s.push && <button type="button" disabled={busy === 'push'} onClick={() => tryIt('push')} className={quietButtonClass}>Send one now</button>}
                {s.push && <button type="button" onClick={() => save({ push: false }, 'push')} className={quietButtonClass}>Turn off</button>}
              </>
            )}>
            {state.browsers.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-gray-600 dark:text-life-200">
                {state.browsers.map((b) => <li key={b.endpoint}>{b.label || 'A browser'} <button type="button" onClick={() => forget(b.endpoint)} className="text-life-600 underline dark:text-life-200">forget</button></li>)}
              </ul>
            )}
          </Way>
        )}
        {!onDevice() && state.can.ntfy && <NtfyWay s={s} services={state.services} busy={busy} said={said.ntfy} save={save} tryIt={tryIt} />}
      </div>
      {!anyOn && <p className="text-xs text-gray-500 dark:text-life-300">Nothing is turned on, so nothing is sent.</p>}
      {said.save && <p className="text-sm text-red-600" role="alert">{said.save}</p>}
    </div>
  );
}

function Way({ icon, title, on, sends, actions, said, children }) {
  return (
    <section className="space-y-1.5 py-3" aria-label={title}>
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">{icon} {title}</h3>
        <span className={`rounded px-1.5 text-[11px] ${on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{on ? 'On' : 'Off'}</span>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100"><span className="font-medium">What it sends:</span> {sends}</p>
      {children}
      <div className="flex flex-wrap gap-2">{actions}</div>
      {said && <p className="text-sm text-gray-700 dark:text-life-100" role="status">{said}</p>}
    </section>
  );
}

function NtfyWay({ s, services, busy, said, save, tryIt }) {
  const [server, setServer] = useState(s.ntfy?.server ?? 'https://ntfy.sh');
  const [full, setFull] = useState(s.ntfy?.detail === 'full');
  return (
    <Way icon="📣" title="ntfy" on={Boolean(s.ntfy)} said={said} sends={services.ntfy.sends}
      actions={s.ntfy ? (
        <>
          <button type="button" disabled={busy === 'ntfy'} onClick={() => tryIt('ntfy')} className={quietButtonClass}>Send one now</button>
          <button type="button" disabled={busy === 'ntfy'} onClick={() => save({ ntfy: null }, 'ntfy')} className={quietButtonClass}>Turn off</button>
        </>
      ) : <button type="button" disabled={busy === 'ntfy'} onClick={() => save({ ntfy: { server, topic: '', detail: full ? 'full' : 'count' } }, 'ntfy')} className={quietButtonClass}>Turn on</button>}>
      {s.ntfy ? (
        <div className="space-y-1 text-sm text-gray-700 dark:text-life-100">
          <p>In the ntfy app, subscribe to this topic{s.ntfy.server !== 'https://ntfy.sh' && <> on <span className="font-mono text-xs">{s.ntfy.server}</span></>}:</p>
          <CopyLine text={s.ntfy.topic} what="the topic" />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={s.ntfy.detail === 'full'} onChange={(e) => save({ ntfy: { ...s.ntfy, detail: e.target.checked ? 'full' : 'count' } }, 'ntfy')} className="accent-life-600" />
            Say what each thing is, not only how many {s.ntfy.server === 'https://ntfy.sh' && <span className="text-xs text-gray-500 dark:text-life-300">(ntfy.sh would be able to read it)</span>}
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
          <label className="flex items-center gap-2">Server <input value={server} onChange={(e) => setServer(e.target.value)} aria-label="ntfy server" className={`${inputClass} !w-56`} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} className="accent-life-600" /> Say what each thing is</label>
        </div>
      )}
    </Way>
  );
}
