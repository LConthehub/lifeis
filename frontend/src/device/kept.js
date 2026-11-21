/**
 * The few small things the app itself must remember between openings: where this phone keeps Life Is (on the
 * phone, or on a Life Is you host), and, when it is a hosted one, the pass that server gave at sign-in.
 *
 * On a phone these go in the phone's own keystore (Android Keystore, iOS Keychain), so nothing else on the
 * phone can read them. In a browser, where the app is only ever tried out, they go in the page's storage.
 */
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const PREFIX = 'lifeis.';

export const kept = {
  async get(name) {
    try { return (await SecureStorage.get(PREFIX + name)) ?? null; } catch (problem) { console.error(problem); return null; }
  },
  set: (name, value) => SecureStorage.set(PREFIX + name, value),
  remove: (name) => SecureStorage.remove(PREFIX + name),
};
