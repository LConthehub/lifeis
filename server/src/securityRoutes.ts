/**
 * Sign-in security: the second step (a code from an authenticator app, or a recovery code), passkeys, and what
 * an admin can do for someone who is locked out. The checking is in secondStep.ts and passkeys.ts; this is
 * the addresses.
 *
 * Signing in, step by step, when two-step is on:
 *   1. POST /api/auth/login with the right password does NOT open a session. It answers
 *      { second_step: true, pending } where `pending` is a random token kept (as a hash) for five minutes,
 *      for that person only.
 *   2. POST /api/auth/second-step { pending, code } with a current code or an unused recovery code opens it.
 *      A passkey can answer instead (…/second-step/passkey/begin and /finish).
 * Wrong codes count against the same limits as wrong passwords (the person's own, the address's, and the
 * pair), and five wrong tries end the pending sign-in.
 */
import { shownName, type Db, type Sealer } from '../../core/src/index.ts';
import * as auth from './auth.ts';
import { read, Refusal, type Context, type Reply, type Route } from './http.ts';
import {
  checkSignIn, cleanName, countPasskeys, finishRegistration, listPasskeys, registrationOptions, signInOptions, whereFrom,
} from './passkeys.ts';
import {
  checkCode, countAttempt, dayWords, dropChallenge, fromBase32, makeChallenge, newSecret, otpAddress, PENDING_MINUTES,
  peekChallenge, recoveryLeft, remakeRecovery, SETUP_MINUTES, securityOf, setNotice, spaced, stepOfCode, takeChallenge, turnOff, turnOn,
} from './secondStep.ts';

const MAX_TRIES = 5;
const STALE = 'That sign-in took too long. Sign in again.';

export type SecurityTools = {
  clock: auth.Clock;
  /** Locks the app's secret. Made when first needed. */
  sealer: () => Sealer;
  /** Whether this is the shared demo, where none of this can be changed. */
  demo: boolean;
  /** Opens a session; answers the headers that carry it. */
  signIn: (c: Context, userId: number, method: string) => Promise<Record<string, string>>;
};

type UserLine = { id: number; username: string; name: string; is_admin: number };

export function securityRoutes(db: Db, tools: SecurityTools) {
  const { clock } = tools;
  const lock = (() => { let sealer: Sealer | null = null; return () => (sealer ??= tools.sealer()); })();

  /** The signed-in person's answer, with what they should be told (an admin turned something off). */
  async function signedIn(c: Context, userId: number, method: string): Promise<Reply> {
    const user = (await db.get<UserLine>(`SELECT u.id, u.username, ${shownName('u')} AS name, u.is_admin FROM users u WHERE u.id = ?`, [userId]))!;
    const notice = (await securityOf(db, userId))?.notice;
    return { json: { id: user.id, username: user.username, name: user.name, is_admin: Boolean(user.is_admin), ...(notice ? { notice } : {}) }, headers: await tools.signIn(c, userId, method) };
  }

  /** After a right password, for someone with two-step on: the token the next step needs, and no session. */
  async function askForSecondStep(userId: number): Promise<Reply> {
    const pending = await makeChallenge(db, 'second_step', userId, null, PENDING_MINUTES, clock);
    return { json: { second_step: true, pending, passkey: (await countPasskeys(db, userId)) > 0, expires_in: PENDING_MINUTES * 60 } };
  }

  const refuseWait = (wait: number) => { if (wait) throw new Refusal(429, `Too many failed attempts. Try again in ${wait} seconds.`); };

  /** The password again, for the changes that matter. A wrong one is counted like a wrong password at sign-in. */
  async function confirmPassword(c: Context, password: string): Promise<void> {
    const counted = auth.countedFor(c.user.username, c.ip);
    refuseWait(await auth.secondsToWait(db, counted, clock));
    const found = await auth.checkLogin(db, c.user.username, password);
    if (!found || found.id !== c.user.id) {
      await auth.countFailure(db, counted, clock);
      throw new Refusal(400, 'That password is wrong');
    }
  }

  /** A code (from the app, or a recovery code) for a change. A wrong one is counted the same way. */
  async function confirmCode(c: Context, code: string): Promise<void> {
    const counted = auth.countedFor(c.user.username, c.ip);
    refuseWait(await auth.secondsToWait(db, counted, clock));
    if (!(await checkCode(db, lock(), c.user.id, code, clock))) {
      await auth.countFailure(db, counted, clock);
      throw new Refusal(400, "That code isn't right");
    }
  }

  const notDemo = () => { if (tools.demo) throw new Refusal(403, "Sign-in security can't be changed in the demo: everyone shares its account"); };
  const signOutOthers = (c: Context) => auth.deleteUserSessions(db, c.user.id, c.token);

  /** The person whose sign-in is waiting for its second step, or the refusal to give. */
  async function pendingFor(c: Context) {
    const pending = read.text(c.body, 'pending');
    refuseWait(await auth.secondsToWait(db, [[auth.ipThrottle, c.ip]], clock));
    const found = await peekChallenge(db, pending, 'second_step', clock);
    const who = found?.user_id ? await db.get<UserLine>(`SELECT u.id, u.username, ${shownName('u')} AS name, u.is_admin FROM users u WHERE u.id = ?`, [found.user_id]) : undefined;
    if (!found || !who) {
      await auth.ipThrottle.failure(db, c.ip, clock);
      throw new Refusal(400, STALE);
    }
    return { pending, who, counted: auth.countedFor(who.username, c.ip) };
  }

  /** A wrong answer at the second step: counted, and the sign-in ends after five. */
  async function wrongAnswer(pending: string, counted: auth.Counted, saying: string): Promise<never> {
    await auth.countFailure(db, counted, clock);
    if ((await countAttempt(db, pending)) >= MAX_TRIES) {
      await dropChallenge(db, pending);
      throw new Refusal(401, `${saying} Too many wrong tries, so sign in again.`);
    }
    throw new Refusal(401, saying);
  }

  const routes: Route[] = [
    // ==================== SIGNING IN: THE SECOND STEP ====================

    ['POST', /^\/api\/auth\/second-step$/, async (c) => {
      const code = read.text(c.body, 'code');
      const { pending, who, counted } = await pendingFor(c);
      refuseWait(await auth.secondsToWait(db, counted, clock));
      const how = await checkCode(db, lock(), who.id, code, clock);
      if (!how) return wrongAnswer(pending, counted, "That code isn't right.");
      if (!(await takeChallenge(db, pending, 'second_step', clock))) throw new Refusal(400, STALE);
      await auth.forgetFailures(db, counted);
      return signedIn(c, who.id, how === 'app' ? 'password+app' : 'password+recovery');
    }],

    ['POST', /^\/api\/auth\/second-step\/passkey\/begin$/, async (c) => {
      const { pending, who } = await pendingFor(c);
      return { json: { options: await signInOptions(db, whereFrom(c.origin), clock, { id: who.id, pending }) } };
    }],

    ['POST', /^\/api\/auth\/second-step\/passkey\/finish$/, async (c) => {
      const { pending, who, counted } = await pendingFor(c);
      refuseWait(await auth.secondsToWait(db, counted, clock));
      const result = await checkSignIn(db, whereFrom(c.origin), c.body.credential, clock, { id: who.id, pending });
      if (!result.ok) return wrongAnswer(pending, counted, "That passkey didn't work.");
      if (!(await takeChallenge(db, pending, 'second_step', clock))) throw new Refusal(400, STALE);
      await auth.forgetFailures(db, counted);
      return signedIn(c, who.id, 'password+passkey');
    }],

    // ==================== SIGNING IN WITH A PASSKEY ALONE ====================

    ['POST', /^\/api\/auth\/passkey\/begin$/, async (c) => ({ json: { options: await signInOptions(db, whereFrom(c.origin), clock) } })],

    ['POST', /^\/api\/auth\/passkey\/finish$/, async (c) => {
      refuseWait(await auth.secondsToWait(db, [[auth.ipThrottle, c.ip]], clock));
      const result = await checkSignIn(db, whereFrom(c.origin), c.body.credential, clock);
      if (!result.ok) {
        const who = result.user_id ? await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [result.user_id]) : undefined;
        await auth.countFailure(db, who ? auth.countedFor(who.username, c.ip) : [[auth.ipThrottle, c.ip]], clock);
        throw new Refusal(401, "That passkey didn't work. Sign in with your password, or try again.");
      }
      const who = (await db.get<{ username: string }>('SELECT username FROM users WHERE id = ?', [result.user_id]))!;
      await auth.forgetFailures(db, auth.countedFor(who.username, c.ip));
      return signedIn(c, result.user_id, 'passkey');
    }],

    // ==================== YOUR OWN SECURITY ====================

    ['GET', /^\/api\/security$/, async (c) => {
      const row = await securityOf(db, c.user.id);
      const on = Boolean(row?.totp_secret);
      return { json: {
        demo: tools.demo,
        second_step: { on, recovery_left: on ? await recoveryLeft(db, c.user.id) : 0 },
        // Passkeys made for another address are listed as such. (At a number, where none can be made, all are.)
        passkeys: await listPasskeys(db, c.user.id, (() => { try { return c.origin ? whereFrom(c.origin).rpId : undefined; } catch { return undefined; } })()),
        notice: row?.notice ?? null,
      } };
    }],

    // Turning two-step on, 1: the password, then a secret to put in an authenticator app. Nothing is on yet.
    ['POST', /^\/api\/security\/second-step\/start$/, async (c) => {
      notDemo();
      await confirmPassword(c, read.text(c.body, 'password'));
      if ((await securityOf(db, c.user.id))?.totp_secret) throw new Refusal(409, 'Two-step sign-in is already on. Turn it off first to set it up again.');
      const secret = newSecret();
      // The secret waits, locked, for the code that proves the app has it.
      const setup = await makeChallenge(db, 'totp_setup', c.user.id, { secret: lock().seal(secret) }, SETUP_MINUTES, clock);
      return { json: { setup, secret: spaced(secret), uri: otpAddress(c.user.username, secret) } };
    }],

    // 2: a current code from the app. Only then is it on, and the recovery codes are shown, once.
    ['POST', /^\/api\/security\/second-step\/confirm$/, async (c) => {
      notDemo();
      const setup = read.text(c.body, 'setup');
      const code = read.text(c.body, 'code').replace(/\s/g, '');
      const counted = auth.countedFor(c.user.username, c.ip);
      refuseWait(await auth.secondsToWait(db, counted, clock));
      const waiting = await peekChallenge(db, setup, 'totp_setup', clock);
      if (!waiting || waiting.user_id !== c.user.id) throw new Refusal(400, 'That took too long. Start setting up again.');
      const secret = lock().unseal(String(waiting.data.secret));
      const step = secret ? stepOfCode(fromBase32(secret), code, clock().getTime()) : null;
      if (!secret || step === null) {
        await auth.countFailure(db, counted, clock);
        if ((await countAttempt(db, setup)) >= MAX_TRIES) { await dropChallenge(db, setup); throw new Refusal(400, "That code isn't right, and that was the last try. Start setting up again."); }
        throw new Refusal(400, "That code isn't right. Check that your phone's clock is set automatically, and type the newest code.");
      }
      if (!(await takeChallenge(db, setup, 'totp_setup', clock))) throw new Refusal(400, 'That took too long. Start setting up again.');
      const codes = await turnOn(db, lock(), c.user.id, secret, step, clock);
      await signOutOthers(c);
      return { json: { recovery_codes: codes } };
    }],

    ['POST', /^\/api\/security\/second-step\/off$/, async (c) => {
      notDemo();
      await confirmPassword(c, read.text(c.body, 'password'));
      if (!(await securityOf(db, c.user.id))?.totp_secret) throw new Refusal(409, 'Two-step sign-in is already off');
      await confirmCode(c, read.text(c.body, 'code'));
      await turnOff(db, c.user.id, clock);
      await signOutOthers(c);
      return { status: 204 };
    }],

    ['POST', /^\/api\/security\/recovery-codes$/, async (c) => {
      notDemo();
      await confirmPassword(c, read.text(c.body, 'password'));
      if (!(await securityOf(db, c.user.id))?.totp_secret) throw new Refusal(409, 'Recovery codes go with two-step sign-in. Turn that on first.');
      return { json: { recovery_codes: await remakeRecovery(db, c.user.id, clock) } };
    }],

    // ---- passkeys ----

    // Adding one needs the password (a session alone isn't enough: a passkey signs in without the second step).
    ['POST', /^\/api\/security\/passkeys\/begin$/, async (c) => {
      notDemo();
      const where = whereFrom(c.origin);
      await confirmPassword(c, read.text(c.body, 'password'));
      return { json: { options: await registrationOptions(db, c.user, where, clock) } };
    }],

    ['POST', /^\/api\/security\/passkeys\/finish$/, async (c) => {
      notDemo();
      const made = await finishRegistration(db, c.user, whereFrom(c.origin), c.body.credential, c.body.name, clock);
      return { status: 201, json: made };
    }],

    ['PUT', /^\/api\/security\/passkeys\/(\d+)$/, async (c) => {
      notDemo();
      const name = cleanName(read.text(c.body, 'name'));
      const done = await db.run('UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?', [name, c.id, c.user.id]);
      if (done.changes !== 1) throw new Refusal(404, 'Not found');
      return { json: { id: c.id, name } };
    }],

    ['DELETE', /^\/api\/security\/passkeys\/(\d+)$/, async (c) => {
      notDemo();
      const done = await db.run('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [c.id, c.user.id]);
      if (done.changes !== 1) throw new Refusal(404, 'Not found');
      return { status: 204 };
    }],

    ['POST', /^\/api\/security\/notice\/dismiss$/, async (c) => {
      notDemo();
      await setNotice(db, c.user.id, null, clock);
      return { status: 204 };
    }],

    // ==================== AN ADMIN HELPING SOMEONE LOCKED OUT ====================

    ['GET', /^\/api\/security\/people$/, async (c) => {
      if (!c.user.is_admin) throw new Refusal(403, 'Only the admin can see this');
      const people = await db.all<{ id: number; username: string; name: string; is_admin: number; second_step: number; passkeys: number }>(
        `SELECT u.id, u.username, ${shownName('u')} AS name, u.is_admin,
           (SELECT COUNT(*) FROM user_security s WHERE s.user_id = u.id AND s.totp_secret IS NOT NULL) AS second_step,
           (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkeys
         FROM users u ORDER BY u.username`);
      return { json: people.map((p) => ({ id: p.id, username: p.username, name: p.name, is_admin: Boolean(p.is_admin), second_step: Boolean(p.second_step), passkeys: p.passkeys, you: p.id === c.user.id })) };
    }],

    // Turns off someone's two-step sign-in and removes their passkeys. Their secret is never shown to anyone.
    ['POST', /^\/api\/security\/people\/(\d+)\/reset$/, async (c) => {
      notDemo();
      if (!c.user.is_admin) throw new Refusal(403, 'Only the admin can do this');
      if (c.id === c.user.id) throw new Refusal(400, 'Change your own sign-in security under Sign-in security.');
      const them = await db.get<UserLine>(`SELECT u.id, u.username, ${shownName('u')} AS name, u.is_admin FROM users u WHERE u.id = ?`, [c.id]);
      if (!them) throw new Refusal(404, 'Not found');
      const twoStep = Boolean((await securityOf(db, c.id))?.totp_secret);
      const keys = await countPasskeys(db, c.id);
      if (!twoStep && !keys) throw new Refusal(409, `${them.username} has no two-step sign-in or passkeys to turn off`);
      const day = dayWords(c.clock.today?.() ?? clock().toISOString().slice(0, 10));
      const did = twoStep && keys ? 'turned off two-step sign-in and removed your passkeys' : twoStep ? 'turned off two-step sign-in' : 'removed your passkeys';
      await turnOff(db, c.id, clock, `An admin ${did} on ${day}.`);
      await db.run('DELETE FROM passkeys WHERE user_id = ?', [c.id]);
      // Whoever was signed in as them is signed out: if the reason is a stranger, this is what ends it.
      await auth.deleteUserSessions(db, c.id);
      return { status: 204 };
    }],
  ];

  return { routes, signedIn, askForSecondStep };
}
