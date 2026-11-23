// Light or dark, as the person chose it (Settings > Look). Runs before the page is drawn, so there is no flash.
// It is a file of its own, not a script written into the page, because the pages only allow scripts from Life Is itself.
// lifeis.theme is 'light', 'dark' or 'system' (follow this device, which is also what no choice at all means).
(function () {
  var root = document.documentElement;
  var query = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function chosen() {
    try { var c = window.localStorage.getItem('lifeis.theme'); return c === 'light' || c === 'dark' ? c : 'system'; } catch (e) { return 'system'; }
  }
  function apply() {
    var c = chosen();
    var dark = c === 'dark' || (c === 'system' && !!query && query.matches);
    if (dark) root.classList.add('dark'); else root.classList.remove('dark');
    root.style.colorScheme = dark ? 'dark' : 'light';
  }
  apply();
  // Keeps up if the device switches while Life Is is open, or the choice is changed in another tab.
  if (query) { if (query.addEventListener) query.addEventListener('change', apply); else if (query.addListener) query.addListener(apply); }
  window.addEventListener('storage', function (e) { if (!e.key || e.key === 'lifeis.theme') apply(); });
  // Paper is always black on white: the dark look is put away while printing and brought back after.
  window.addEventListener('beforeprint', function () { root.classList.remove('dark'); });
  window.addEventListener('afterprint', apply);
  window.lifeisApplyTheme = apply;
})();
