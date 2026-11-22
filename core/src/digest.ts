/**
 * Signing in the way Calibre's Content server asks over plain http: "Digest" (RFC 7616, with MD5). The
 * password is never sent; what is sent is a fingerprint of it mixed with a number the server hands out, so
 * someone listening on the network can't read it off.
 *
 * `signedFetcher` wraps a fetcher: it asks, and when the server answers "sign in" it answers the way the
 * server asked (Digest, or Basic), then keeps signing each later request the same way. Nothing else changes.
 *
 * MD5 is written out here because it must run everywhere Life Is does (a phone's browser has no MD5 of its
 * own). It is only ever used for this sign-in, which the server chooses; nothing in Life Is is protected by it.
 */
import type { Answer, Fetcher } from './connections.ts';

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** The MD5 fingerprint of some text, as 32 hex digits. */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (length * 8) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(length / 2 ** 29), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let block = 0; block < padded.length; block += 64) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; } else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const sum = (a + f + K[i]! + view.getUint32(block + g * 4, true)) >>> 0;
      a = d; d = c; c = b;
      b = (b + ((sum << S[i]!) | (sum >>> (32 - S[i]!)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((word, i) => out.setUint32(i * 4, word, true));
  return [...new Uint8Array(out.buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

type Challenge = { realm: string; nonce: string; opaque: string | null; qop: boolean; algorithm: string | null };

/** What the server asked for, out of its "WWW-Authenticate: Digest …" line. Null when it isn't Digest. */
export function digestChallenge(header: string | null | undefined): Challenge | null {
  const said = /\bDigest\s+(.*)$/is.exec(header ?? '')?.[1];
  if (!said) return null;
  const part = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|([^\\s,]+))`, 'i').exec(said)?.slice(1).find((v) => v !== undefined) ?? null;
  const realm = part('realm');
  const nonce = part('nonce');
  if (realm === null || nonce === null) return null;
  return { realm, nonce, opaque: part('opaque'), qop: /(^|,|\s)auth(,|\s|$)/.test(part('qop') ?? ''), algorithm: part('algorithm') };
}

/** The "Authorization: Digest …" line that answers a challenge, for one request. `count` is how many times this nonce has been used. */
export function digestAnswer(challenge: Challenge, username: string, password: string, method: string, uri: string, count: number, clientNonce: string): string {
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = count.toString(16).padStart(8, '0');
  const response = challenge.qop ? md5(`${ha1}:${challenge.nonce}:${nc}:${clientNonce}:auth:${ha2}`) : md5(`${ha1}:${challenge.nonce}:${ha2}`);
  const quoted = (value: string) => `"${value.replace(/["\\]/g, '')}"`;
  return `Digest username=${quoted(username)}, realm=${quoted(challenge.realm)}, nonce=${quoted(challenge.nonce)}, uri=${quoted(uri)}, response="${response}"`
    + (challenge.algorithm ? `, algorithm=${challenge.algorithm.replace(/[^\w-]/g, '')}` : '')
    + (challenge.opaque !== null ? `, opaque=${quoted(challenge.opaque)}` : '')
    + (challenge.qop ? `, qop=auth, nc=${nc}, cnonce="${clientNonce}"` : '');
}

const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * A fetcher that signs in as the server asks. Asked for Digest, it answers with Digest; asked for Basic, with
 * Basic; never asked, it sends no sign-in at all. A server that still says no after that is passed on as it is.
 */
export function signedFetcher(fetcher: Fetcher, username: string, password: string): Fetcher {
  let challenge: Challenge | null = null;
  let count = 0;
  let basic = false;
  const sign = (url: string, method: string): Record<string, string> => {
    if (basic) return { Authorization: `Basic ${btoa(unescape(encodeURIComponent(`${username}:${password}`)))}` };
    if (!challenge) return {};
    const at = new URL(url);
    count += 1;
    return { Authorization: digestAnswer(challenge, username, password, method, at.pathname + at.search, count, randomHex()) };
  };
  return async (url, headers, send) => {
    const method = send?.method ?? 'GET';
    let answer: Answer = await fetcher(url, { ...headers, ...sign(url, method) }, send);
    if (answer.status !== 401) return answer;
    // Asked to sign in, or told the number it handed out has gone stale: answer the fresh challenge, once.
    const asked = answer.header?.('www-authenticate') ?? null;
    const fresh = digestChallenge(asked);
    if (fresh) { challenge = fresh; count = 0; basic = false; } else if (/\bBasic\b/i.test(asked ?? '') && !basic) { basic = true; } else return answer;
    answer = await fetcher(url, { ...headers, ...sign(url, method) }, send);
    return answer;
  };
}
