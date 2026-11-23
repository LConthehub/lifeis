// Passkeys (WebAuthn), asked of the browser directly. The server sends options as JSON with the binary parts in
// base64url; the browser wants ArrayBuffers, and its answer goes back as base64url JSON. Nothing is loaded from
// anywhere else: this is the whole of it.
import axios from 'axios';
import { inApp } from '../where';

const toBuffer = (text) => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer;
};
const toText = (buffer) => {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Why passkeys can't be used here, in words, or null when they can. They need a secure page (https, or http on
 * localhost), a browser that has them, and an address with a name (a passkey is tied to the name, so a number
 * such as 192.168.1.5 won't do). They are not offered inside the phone app, whose pages aren't at the server's address.
 */
export function passkeyProblem() {
  if (typeof window === 'undefined' || inApp()) return 'Passkeys work in a browser, at your Life Is address. Two-step sign-in with an authenticator app works here.';
  if (!window.isSecureContext) return 'Passkeys need https, or http on localhost. Open Life Is at one of those to use them. Two-step sign-in with an authenticator app works at any address.';
  if (!window.PublicKeyCredential) return "This browser can't make passkeys. Two-step sign-in with an authenticator app still works.";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname) || window.location.hostname.includes(':')) {
    return 'Passkeys need an address with a name (https://home.example, or http://localhost), not a number such as 192.168.1.5. Two-step sign-in with an authenticator app still works.';
  }
  return null;
}
export const passkeysUsable = () => passkeyProblem() === null;

/** A prompt the person cancelled or let run out: nothing to report. */
export const passkeyCancelled = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';

function forCreate(o) {
  return {
    ...o,
    challenge: toBuffer(o.challenge),
    user: { ...o.user, id: toBuffer(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: toBuffer(c.id) })),
  };
}

function forGet(o) {
  const { allowCredentials, ...rest } = o;
  return { ...rest, challenge: toBuffer(o.challenge), ...(allowCredentials?.length ? { allowCredentials: allowCredentials.map((c) => ({ ...c, id: toBuffer(c.id) })) } : {}) };
}

function asJson(credential) {
  const r = credential.response;
  const response = { clientDataJSON: toText(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = toText(r.attestationObject);
    if (r.getTransports) response.transports = r.getTransports();
  }
  if (r.authenticatorData) {
    response.authenticatorData = toText(r.authenticatorData);
    response.signature = toText(r.signature);
    if (r.userHandle) response.userHandle = toText(r.userHandle);
  }
  return {
    id: credential.id, rawId: toText(credential.rawId), type: credential.type, response,
    authenticatorAttachment: credential.authenticatorAttachment || undefined,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
  };
}

/** Makes a passkey for the signed-in person on this device. Needs their password. */
export async function addPasskey(password, name) {
  const { data } = await axios.post('/api/security/passkeys/begin', { password });
  const made = await navigator.credentials.create({ publicKey: forCreate(data.options) });
  const { data: saved } = await axios.post('/api/security/passkeys/finish', { credential: asJson(made), name });
  return saved;
}

/** Signs in with a passkey, no username or password. Answers as the password sign-in does. */
export async function signInWithPasskey() {
  const { data: begun } = await axios.post('/api/auth/passkey/begin');
  const got = await navigator.credentials.get({ publicKey: forGet(begun.options) });
  const { data } = await axios.post('/api/auth/passkey/finish', { credential: asJson(got) });
  return data;
}

/** The second step with a passkey, for a sign-in that has had its password. */
export async function secondStepWithPasskey(pending) {
  const { data: begun } = await axios.post('/api/auth/second-step/passkey/begin', { pending });
  const got = await navigator.credentials.get({ publicKey: forGet(begun.options) });
  const { data } = await axios.post('/api/auth/second-step/passkey/finish', { pending, credential: asJson(got) });
  return data;
}

/** A name to suggest for a passkey made on this device. */
export function guessDevice() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows computer';
  return 'This device';
}
