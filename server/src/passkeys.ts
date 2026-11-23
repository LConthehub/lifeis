/**
 * Passkeys (WebAuthn): signing in with the device's own lock (face, fingerprint or PIN) instead of a password,
 * or as the second step after one.
 *
 * The checking of what a device sends is done by @simplewebauthn/server, a widely used library. What this file
 * adds is Life Is's own strictness around it:
 * - The address and the origin come from the request itself (the app is hosted at many addresses), and are
 *   checked on every ceremony, against what the challenge was made for as well as what the browser signed.
 * - A challenge is random, kept as a hash, single use, five minutes, and for one purpose (and, to register, one
 *   person). It is used up the first time anything answers it, right or wrong.
 * - No attestation is asked for, and none is accepted: a device that sends one anyway is refused before the
 *   library sees it, so nothing the device sends can make Life Is look anything up (the library fetches
 *   certificate revocation lists for some attestations).
 * - The signature counter is checked here, after the signature is: one that doesn't move forward refuses the
 *   sign-in and flags the passkey, which then can't be used until it is removed. (Many passkeys always say 0,
 *   which is fine.)
 */
import { isIP } from 'node:net';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { decodeAttestationObject, decodeClientDataJSON, isoBase64URL } from '@simplewebauthn/server/helpers';
import { atomic, type Db } from '../../core/src/index.ts';
import type { Clock, User } from './auth.ts';
import { Refusal } from './http.ts';
import { ISSUER, makeChallenge, takeChallenge, tokenKey, userHandle } from './secondStep.ts';

export const PASSKEY_MINUTES = 5;
export const MAX_PASSKEYS = 20;
/** Ed25519, ES256 and RS256: what devices make. (The library's own list may also offer newer ones.) */
const ALGORITHMS = [-8, -7, -257];
const stamp = (at: Date) => at.toISOString().slice(0, 19) + '+00:00';

export type Where = { origin: string; rpId: string };

/** Where the person is, from the request: the address passkeys are tied to. */
export function whereFrom(origin: string | undefined): Where {
  if (!origin) throw new Refusal(400, "Passkeys need to know the web address you're using");
  let url: URL;
  try { url = new URL(origin); } catch { throw new Refusal(400, "Passkeys need to know the web address you're using"); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) throw new Refusal(400, "Passkeys need a web address with a name, like https://home.example or http://localhost. They don't work at a number such as 192.168.1.5.");
  return { origin: url.origin, rpId: url.hostname };
}

type PasskeyRow = {
  id: number; user_id: number; credential_id: string; public_key: string; counter: number; transports: string | null;
  backed_up: number; multi_device: number; rp_id: string; name: string; created_at: string; last_used_at: string | null; flagged_at: string | null;
};

const transportsOf = (text: string | null): string[] => { try { const t = JSON.parse(text ?? '[]'); return Array.isArray(t) ? t.filter((x) => typeof x === 'string') : []; } catch { return []; } };

/** Someone's passkeys as the page shows them: never the key, only what a person would want to see. */
export async function listPasskeys(db: Db, userId: number, rpId?: string) {
  const rows = await db.all<PasskeyRow>('SELECT * FROM passkeys WHERE user_id = ? ORDER BY id', [userId]);
  return rows.map((p) => ({
    id: p.id, name: p.name, created_on: p.created_at.slice(0, 10), last_used_on: p.last_used_at?.slice(0, 10) ?? null,
    backed_up: Boolean(p.backed_up), multi_device: Boolean(p.multi_device), flagged: Boolean(p.flagged_at),
    here: rpId === undefined ? true : p.rp_id === rpId,
  }));
}

export const countPasskeys = async (db: Db, userId: number) =>
  (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', [userId]))!.n;

export function cleanName(given: unknown): string {
  const name = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  return name || 'Passkey';
}

const object = (x: unknown): x is Record<string, any> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** The challenge a device signed, read from what it sent back; null when it isn't there. */
function challengeIn(credential: unknown): string | null {
  try {
    if (!object(credential) || !object(credential.response) || typeof credential.response.clientDataJSON !== 'string') return null;
    const challenge = decodeClientDataJSON(credential.response.clientDataJSON).challenge;
    return typeof challenge === 'string' ? challenge : null;
  } catch {
    return null;
  }
}

// ---------- registering ----------

export async function registrationOptions(db: Db, user: User, where: Where, clock: Clock) {
  if ((await countPasskeys(db, user.id)) >= MAX_PASSKEYS) throw new Refusal(400, `That's the most passkeys (${MAX_PASSKEYS}). Remove one you don't use first.`);
  const have = await db.all<PasskeyRow>('SELECT * FROM passkeys WHERE user_id = ?', [user.id]);
  const options = await generateRegistrationOptions({
    rpName: ISSUER, rpID: where.rpId, userName: user.username, userDisplayName: user.username,
    userID: new Uint8Array(await userHandle(db, user.id, clock)), attestationType: 'none', timeout: PASSKEY_MINUTES * 60_000,
    excludeCredentials: have.map((p) => ({ id: p.credential_id, transports: transportsOf(p.transports) as any })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    supportedAlgorithmIDs: ALGORITHMS,
  });
  await makeChallenge(db, 'passkey_register', user.id, { origin: where.origin }, PASSKEY_MINUTES, clock, options.challenge);
  return options;
}

export async function finishRegistration(db: Db, user: User, where: Where, credential: unknown, name: unknown, clock: Clock): Promise<{ id: number; name: string }> {
  const tooSlow = new Refusal(400, 'That took too long, or was already used. Try adding the passkey again.');
  const challenge = challengeIn(credential);
  const asked = challenge ? await takeChallenge(db, challenge, 'passkey_register', clock) : null;
  if (!challenge || !asked || asked.user_id !== user.id || asked.data.origin !== where.origin) throw tooSlow;
  const sorry = new Refusal(400, "That passkey couldn't be checked, so it wasn't added.");
  let info;
  try {
    const response = credential as any;
    if (typeof response.response.attestationObject !== 'string') throw new Error('no attestation object');
    // Life Is asks for no attestation and accepts none.
    if (decodeAttestationObject(isoBase64URL.toBuffer(response.response.attestationObject)).get('fmt') !== 'none') throw new Error('attestation not accepted');
    const verified = await verifyRegistrationResponse({
      response, expectedChallenge: challenge, expectedOrigin: where.origin, expectedRPID: where.rpId,
      requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS,
    });
    if (!verified.verified || !verified.registrationInfo) throw new Error('not verified');
    info = verified.registrationInfo;
  } catch {
    throw sorry;
  }
  const kept = cleanName(name);
  const sent = (credential as any).response.transports;
  const transports = Array.isArray(sent) ? sent.filter((t: unknown) => typeof t === 'string').slice(0, 8) : (info.credential.transports ?? []);
  return atomic(db, async (tx) => {
    if ((await tx.get<{ n: number }>('SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?', [user.id]))!.n >= MAX_PASSKEYS) throw new Refusal(400, `That's the most passkeys (${MAX_PASSKEYS}).`);
    if (await tx.get('SELECT 1 AS taken FROM passkeys WHERE credential_id = ?', [info.credential.id])) throw new Refusal(409, 'That passkey is already added.');
    const made = await tx.run(
      `INSERT INTO passkeys (user_id, credential_id, public_key, counter, transports, backed_up, multi_device, rp_id, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [user.id, info.credential.id, Buffer.from(info.credential.publicKey).toString('base64url'), info.credential.counter,
        JSON.stringify(transports), info.credentialBackedUp ? 1 : 0, info.credentialDeviceType === 'multiDevice' ? 1 : 0, where.rpId, kept, stamp(clock())]);
    return { id: made.lastId, name: kept };
  });
}

// ---------- signing in ----------

/**
 * Options for a device to sign. Without `forUser`, any passkey for this address may answer (the person is not
 * named: the passkey says who it is). With `forUser` (the second step), only that person's.
 */
export async function signInOptions(db: Db, where: Where, clock: Clock, forUser?: { id: number; pending: string }) {
  const have = forUser ? await db.all<PasskeyRow>('SELECT * FROM passkeys WHERE user_id = ? AND rp_id = ? AND flagged_at IS NULL', [forUser.id, where.rpId]) : [];
  const options = await generateAuthenticationOptions({
    rpID: where.rpId, userVerification: 'required', timeout: PASSKEY_MINUTES * 60_000,
    allowCredentials: have.map((p) => ({ id: p.credential_id, transports: transportsOf(p.transports) as any })),
  });
  await makeChallenge(db, forUser ? 'passkey_second' : 'passkey_login', forUser?.id ?? null,
    { origin: where.origin, ...(forUser ? { pending: tokenKey(forUser.pending) } : {}) }, PASSKEY_MINUTES, clock, options.challenge);
  return options;
}

export type PasskeyResult = { ok: true; user_id: number; passkey: number } | { ok: false; user_id: number | null };

/**
 * What a device sent to sign in. `forUser` is given at the second step (the person already proved their
 * password, so only their passkeys and only that sign-in's challenge count).
 */
export async function checkSignIn(db: Db, where: Where, credential: unknown, clock: Clock, forUser?: { id: number; pending: string }): Promise<PasskeyResult> {
  const challenge = challengeIn(credential);
  const asked = challenge ? await takeChallenge(db, challenge, forUser ? 'passkey_second' : 'passkey_login', clock) : null;
  if (!challenge || !asked || asked.data.origin !== where.origin) return { ok: false, user_id: forUser?.id ?? null };
  if (forUser && (asked.user_id !== forUser.id || asked.data.pending !== tokenKey(forUser.pending))) return { ok: false, user_id: forUser.id };

  const sent = credential as any;
  const row = typeof sent.id === 'string'
    ? await db.get<PasskeyRow>('SELECT * FROM passkeys WHERE credential_id = ? AND rp_id = ?', [sent.id, where.rpId])
    : undefined;
  if (!row) return { ok: false, user_id: forUser?.id ?? null };
  const known = { ok: false as const, user_id: row.user_id };
  if (forUser && row.user_id !== forUser.id) return { ok: false, user_id: forUser.id };
  if (row.flagged_at) return known;
  // A discoverable passkey says whose it is; if it names someone other than its owner, something is wrong.
  const handle = sent.response?.userHandle;
  if (typeof handle === 'string' && handle) {
    const mine = (await db.get<{ webauthn_handle: string | null }>('SELECT webauthn_handle FROM user_security WHERE user_id = ?', [row.user_id]))?.webauthn_handle;
    if (!mine || mine !== handle) return known;
  }
  let counter: number;
  let backedUp: boolean;
  try {
    const verified = await verifyAuthenticationResponse({
      response: sent, expectedChallenge: challenge, expectedOrigin: where.origin, expectedRPID: where.rpId, requireUserVerification: true,
      // The library's own counter test runs before it checks the signature, so a forged answer with a low
      // counter could flag someone's passkey. It is told 0 here, and the counter is checked below instead.
      credential: { id: row.credential_id, publicKey: Buffer.from(row.public_key, 'base64url'), counter: 0, transports: transportsOf(row.transports) as any },
    });
    if (!verified.verified) return known;
    counter = verified.authenticationInfo.newCounter;
    backedUp = verified.authenticationInfo.credentialBackedUp;
  } catch {
    return known;
  }
  if ((counter > 0 || row.counter > 0) && counter <= row.counter) {
    // It went backwards (or stood still): the passkey may have been copied. It is refused from now on.
    await db.run('UPDATE passkeys SET flagged_at = ? WHERE id = ?', [stamp(clock()), row.id]);
    return known;
  }
  await db.run('UPDATE passkeys SET counter = ?, last_used_at = ?, backed_up = ? WHERE id = ?', [counter, stamp(clock()), backedUp ? 1 : 0, row.id]);
  return { ok: true, user_id: row.user_id, passkey: row.id };
}
