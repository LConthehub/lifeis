/**
 * Where this copy of the pages is running, for the few places that must know.
 *   - in a browser, talking to the Life Is that served them (none of these are true);
 *   - in the app, keeping everything on the device (`onDevice`);
 *   - in the app, signed in to a Life Is the person hosts (`linkedServer`).
 */
const app = () => (typeof window !== 'undefined' ? window.lifeisApp : undefined);

/** Whether these pages are inside the app, rather than a browser. */
export const inApp = () => Boolean(app());
/** Whether Life Is is keeping everything on this device, rather than talking to a server. */
export const onDevice = () => app()?.place.kind === 'device';
/** The address of the Life Is this app is signed in to, or null. */
export const linkedServer = () => (app()?.place.kind === 'server' ? app().place.address : null);
/** The address other things (a calendar app, a sticker) should use to reach this Life Is. */
export const serverOrigin = () => linkedServer() ?? window.location.origin;
/** In the app: back to the question of where this phone keeps Life Is. */
export const chooseAgain = () => app()?.chooseAgain();
