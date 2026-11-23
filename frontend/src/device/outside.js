/**
 * The way out, when everything is kept on the phone: how Life Is asks an outside address for something (the
 * weather, a recipe's web page), and only ever when a page the person is using asks for it.
 *
 * The phone makes the request itself. A page inside an app is not allowed to read other sites; the phone is.
 */
import { CapacitorHttp } from '@capacitor/core';

const unpacked = (base64) => Uint8Array.from(atob(base64 ?? ''), (c) => c.charCodeAt(0));

export const phoneFetcher = async (url, headers, send) => {
  const got = await CapacitorHttp.request({ url, method: send?.method ?? 'GET', headers, data: send?.body, responseType: 'arraybuffer', connectTimeout: 10000, readTimeout: 30000 });
  const bytes = typeof got.data === 'string' ? unpacked(got.data) : new Uint8Array();
  let type = null;
  for (const name of Object.keys(got.headers ?? {})) if (name.toLowerCase() === 'content-type') type = got.headers[name];
  const header = (wanted) => { for (const name of Object.keys(got.headers ?? {})) if (name.toLowerCase() === wanted.toLowerCase()) return got.headers[name]; return null; };
  return { status: got.status, type, header, bytes: async () => bytes, json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
};
