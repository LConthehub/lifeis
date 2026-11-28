/**
 * Where the app starts. The same pages as always (App), with one difference made here: where their requests
 * go. Either they are answered inside the app (answer.js) from a database on the phone, or they are sent to
 * a Life Is the person hosts (remote.js). Which one is asked once (Welcome) and remembered (kept.js).
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import axios, { AxiosError } from 'axios';
import { Capacitor } from '@capacitor/core';
import { migrate } from '../../../core/src/index.ts';
import App from '../App';
import '../index.css';
import { kept } from './kept.js';
import Welcome from './Welcome.jsx';

const root = ReactDOM.createRoot(document.getElementById('root'));
const onPhone = Capacitor.isNativePlatform();

/** Everything kept on this phone: the handlers and the database are inside the app. */
async function onThisPhone() {
  // On a phone the database is encrypted. In a browser, where the app is only tried out, a stand-in is used.
  const { db, saved } = onPhone ? await (await import('./nativeDatabase.js')).openNativeDatabase() : await (await import('./database.js')).openDeviceDatabase();
  await migrate(db);
  const { deviceAnswers } = await import('./answer.js');
  const fetcher = onPhone ? (await import('./outside.js')).phoneFetcher : undefined;
  // The phone's own built-in AI, where it has one. In a browser, where the app is only tried out, a test can
  // hand in a stand-in as window.lifeisTryPhoneModel.
  const phone = onPhone ? (await import('./phoneModel.js')).phoneModel() : window.lifeisTryPhoneModel ?? null;
  const outside = { ...(fetcher ? { fetcher } : {}), ...(fetcher || phone ? { assistant: { ...(fetcher ? { fetcher } : {}), ...(phone ? { phone } : {}) } } : {}) };
  // When the free trial began is kept in the phone's keystore, not the database, so bringing a backup back
  // neither restarts it nor ends it. Whether it is unlocked will come from the app store, once it is in one.
  const held = {
    read: async () => ({ trial_started: await kept.get('trial_started'), unlocked: (await kept.get('unlocked')) === true }),
    begin: (iso) => kept.set('trial_started', iso),
  };
  const answer = await deviceAnswers(db, outside, held);

  // Every request the pages make with axios comes here instead of going out.
  axios.defaults.adapter = async (config) => {
    const address = axios.getUri(config);
    let body = config.data;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const got = await answer((config.method ?? 'get').toUpperCase(), address, body);
    const response = { data: got.data, status: got.status, statusText: '', headers: got.headers, config, request: null };
    if (got.status >= 200 && got.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${got.status}`, got.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, null, response);
  };
  // For trying it out: lets a test wait until what was written is kept.
  window.lifeisDevice = { saved };
}

/** A window onto a Life Is the person hosts: every request goes to that address. */
async function onTheirServer(address) {
  const { remoteAdapter } = await import('./remote.js');
  axios.defaults.adapter = await remoteAdapter(address, kept);
}

async function start() {
  const place = await kept.get('place');
  if (!place) {
    const chosen = async (next) => { await kept.set('place', next); window.location.replace('/'); };
    // A backup from another phone, brought back before anything else. The phone's own Life Is is opened (once)
    // to put it in. If the phone already holds one, nothing is changed until the person says to replace it.
    let opened = null;
    const bringBack = async (file, passphrase, sure) => {
      opened ??= onThisPhone();
      try { await opened; } catch (problem) { opened = null; throw problem; }
      if (!sure && (await axios.get('/api/start')).data.status !== 'new') return { holds: true };
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text = '';
      for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      await axios.post('/api/device/restore', { passphrase, file: btoa(text) });
      await window.lifeisDevice?.saved?.();
      await chosen({ kind: 'device' });
      return {};
    };
    root.render(<React.StrictMode><Welcome onChosen={chosen} onBringBack={bringBack} /></React.StrictMode>);
    return;
  }
  if (place.kind === 'server') await onTheirServer(place.address); else await onThisPhone();
  window.lifeisApp = {
    place,
    /** Back to the first question. Nothing held in either place is touched; only the pass to a server is dropped. */
    async chooseAgain() {
      if (place.kind === 'server') { await axios.post('/api/auth/logout').catch(() => {}); await (await import('./remote.js')).forget(kept); }
      await kept.remove('place');
      window.location.replace('/');
    },
  };
  root.render(<React.StrictMode><App /></React.StrictMode>);
  if (place.kind === 'device') weeklyBackup();
  if (onPhone) {
    await followLinks();
    await phoneReminders();
  }
}

/** The morning reminders made on the phone: scheduled now, again whenever the app comes back, and when changed. */
async function phoneReminders() {
  const { scheduleReminders, followReminderTaps } = await import('./phoneReminders.js');
  const { App: Phone } = await import('@capacitor/app');
  const again = () => scheduleReminders().catch((problem) => console.error(problem));
  followReminderTaps(goTo);
  Phone.addListener('appStateChange', ({ isActive }) => { if (isActive) again(); });
  window.addEventListener('lifeis-reminders', again);
  await again();
}

/** The backup that makes itself (autoBackup.js): looked at a moment after opening, and whenever the app comes back. */
function weeklyBackup() {
  const look = () => import('./autoBackup.js').then((m) => m.autoBackupIfDue()).catch((problem) => console.error(problem));
  setTimeout(look, 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
}

/** Show a page of the app, as if it had been tapped to. */
function goTo(path) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * A link that opens the app (living.lifeis.home://do/add-to-groceries?item=eggs, from a shortcut on the icon,
 * Siri or Google) goes to that page in the app, as if it had been tapped there.
 */
async function followLinks() {
  const { App: Phone } = await import('@capacitor/app');
  const go = (address) => {
    let url;
    try { url = new URL(address); } catch { return; }
    const path = `/${url.host}${url.pathname}`.replace(/\/+$/, '');
    if (!/^\/do\/[a-z-]{1,40}$/.test(path)) return;
    window.history.pushState({}, '', path + url.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  const first = await Phone.getLaunchUrl().catch(() => null);
  if (first?.url) go(first.url);
  Phone.addListener('appUrlOpen', ({ url }) => go(url));
}

start().catch((problem) => {
  console.error(problem);
  root.render(<p style={{ padding: 24, fontFamily: 'sans-serif' }}>Life Is couldn't open on this device. {String(problem?.message ?? problem)}</p>);
});
