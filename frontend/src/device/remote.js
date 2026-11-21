/**
 * The app as a window onto a Life Is you host yourself.
 *
 * Nothing is kept on the phone in this mode but the server's address and the pass it gave at sign-in (both in
 * the phone's keystore). Every request the pages make is sent to that one address and nowhere else.
 *
 * On a phone the request is made by the phone itself, not by the page inside the app, so it reaches a server
 * on the home network (http://192.168…) as readily as one with a proper certificate. In a browser, where
 * this is only tried out, the page asks the address it was loaded from.
 */
import { AxiosError } from 'axios';
import { Capacitor, CapacitorHttp } from '@capacitor/core';

const onPhone = () => Capacitor.isNativePlatform();

/** What was typed, as an address to send to. "lifeis.example.org" is taken to mean https. Throws in words. */
export function tidyAddress(given) {
  const typed = String(given ?? '').trim();
  if (!typed) throw new Error('Type the address of your Life Is');
  let url;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`); } catch { throw new Error("That doesn't look like an address"); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The address should start with https:// or http://');
  if (url.username || url.password) throw new Error("Leave the name and password out of the address; you'll sign in next");
  return url.origin;
}

/** Whether an address is plain http, which anyone on the same network can read. */
export const unlocked = (address) => address.startsWith('http://');

async function ask(server, { method, path, headers, body, bytes }) {
  if (onPhone()) {
    const got = await CapacitorHttp.request({
      url: server + path, method, headers, data: body, responseType: bytes ? 'arraybuffer' : 'json', connectTimeout: 10000, readTimeout: 60000,
    });
    let data = got.data;
    if (bytes && typeof data === 'string') data = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)).buffer;
    return { status: got.status, headers: got.headers ?? {}, data };
  }
  const got = await fetch(server + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'include' });
  const kind = got.headers.get('Content-Type') ?? '';
  const data = bytes ? await got.arrayBuffer() : kind.includes('json') ? await got.json() : await got.text();
  return { status: got.status, headers: Object.fromEntries(got.headers), data };
}

/** Asks an address whether a Life Is answers there. Resolves, or throws in words. */
export async function findLifeIs(server) {
  let got;
  try { got = await ask(server, { method: 'GET', path: '/api/health', headers: { Accept: 'application/json' } }); } catch { throw new Error(`Nothing answered at ${server}. Is it running, and is this phone on a network that can reach it?`); }
  if (got.status !== 200 || got.data?.status !== 'ok') throw new Error(`Something answered at ${server}, but it isn't Life Is.`);
}

const header = (headers, name) => { for (const key of Object.keys(headers)) if (key.toLowerCase() === name) return headers[key]; return undefined; };

/**
 * Sends the pages' requests to the server. `kept` remembers the pass between openings.
 * The pass is the same one a browser would hold for that server, and is sent only to it.
 */
export async function remoteAdapter(server, kept) {
  let passes = (await kept.get('passes')) ?? {};
  const remember = async (said) => {
    if (!said) return;
    let changed = false;
    // "name=value; Max-Age=…" once per pass; some phones join several with commas.
    for (const [, name, value, rest] of String(said).matchAll(/(?:^|,\s*)([A-Za-z0-9_-]+)=([^;,\s]*)([^,]*)/g)) {
      if (!value || /max-age=0\b/i.test(rest)) delete passes[name]; else passes[name] = value;
      changed = true;
    }
    if (changed) await kept.set('passes', passes);
  };

  return async function adapter(config) {
    const url = new URL(config.url, 'http://lifeis');
    for (const [name, value] of Object.entries(config.params ?? {})) if (value !== undefined && value !== null) url.searchParams.set(name, value);
    const headers = { Accept: 'application/json' };
    for (const [name, value] of Object.entries(config.headers?.toJSON?.() ?? {})) if (/^x-/i.test(name) && value != null) headers[name] = String(value);
    let body = config.data;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = undefined; } }
    if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
    const mine = Object.entries(passes).map(([name, value]) => `${name}=${value}`).join('; ');
    if (onPhone() && mine) headers.Cookie = mine;

    let got;
    try {
      got = await ask(server, { method: (config.method ?? 'get').toUpperCase(), path: url.pathname + url.search, headers, body: body ?? undefined, bytes: config.responseType === 'arraybuffer' });
    } catch (problem) {
      throw new AxiosError(`Couldn't reach ${server}`, AxiosError.ERR_NETWORK, config, null);
    }
    if (onPhone()) await remember(header(got.headers, 'set-cookie'));
    const type = header(got.headers, 'content-type');
    const response = { data: got.data ?? '', status: got.status, statusText: '', headers: { ...got.headers, ...(type ? { 'Content-Type': type } : {}) }, config, request: null };
    if (got.status >= 200 && got.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${got.status}`, got.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST, config, null, response);
  };
}

/** Forgets the pass (on leaving a server). The server's own sign-out is asked for first, by the page. */
export async function forget(kept) {
  await kept.remove('passes');
  if (onPhone()) { const { CapacitorCookies } = await import('@capacitor/core'); await CapacitorCookies.clearAllCookies().catch(() => {}); }
}
