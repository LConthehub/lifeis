import { lazy } from 'react';

// A page whose code loads the first time it is opened. After a new version goes
// live, a tab that was already open can ask for a page file that is gone; then
// the page reloads once to pick up the new version instead of showing an error.
const KEY = 'lifeis-page-reload';

export default function lazyPage(load) {
  return lazy(() =>
    load().then(
      (m) => {
        try { sessionStorage.removeItem(KEY); } catch { /* storage may be off */ }
        return m;
      },
      (err) => {
        let tried = false;
        try { tried = sessionStorage.getItem(KEY) === '1'; sessionStorage.setItem(KEY, '1'); } catch { tried = true; }
        if (!tried) {
          window.location.reload();
          return new Promise(() => {});
        }
        throw err;
      },
    ),
  );
}
