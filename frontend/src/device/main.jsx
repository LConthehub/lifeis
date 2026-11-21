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
  const outside = onPhone ? { fetcher: (await import('./outside.js')).phoneFetcher } : {};
  const answer = await deviceAnswers(db, outside);

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
    root.render(<React.StrictMode><Welcome onChosen={chosen} /></React.StrictMode>);
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
}

start().catch((problem) => {
  console.error(problem);
  root.render(<p style={{ padding: 24, fontFamily: 'sans-serif' }}>Life Is couldn't open on this device. {String(problem?.message ?? problem)}</p>);
});
