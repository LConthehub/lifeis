// Copy buttons for code on the guides. Runs only in your browser; nothing is sent anywhere.
// Without JavaScript there are no buttons, and the code is still there to read and select.
(function () {
  'use strict';
  var live = null;
  var timers = new WeakMap();

  function announce(text) {
    if (!live) {
      live = document.createElement('div');
      live.className = 'sr';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      document.body.appendChild(live);
    }
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 40);
  }

  // Select the text so Ctrl+C finishes the job when the browser will not copy for us.
  function select(el) {
    if (!el) return false;
    if (typeof el.select === 'function') { el.focus(); el.select(); return true; }
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function show(button, message, ms) {
    if (!button.hasAttribute('data-label')) button.setAttribute('data-label', button.textContent);
    button.textContent = message;
    announce(message);
    clearTimeout(timers.get(button));
    timers.set(button, setTimeout(function () { button.textContent = button.getAttribute('data-label'); }, ms));
  }

  /** Copy `text` exactly as given. If the browser refuses, select `target` and say so. */
  function copy(button, text, target) {
    function manual() {
      select(target);
      // An older way that still works where the new one is missing, as long as the text is selected.
      var done = false;
      try { done = document.execCommand && document.execCommand('copy'); } catch (e) { done = false; }
      if (done) show(button, 'Copied', 2000); else show(button, 'Press Ctrl+C to copy', 6000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { show(button, 'Copied', 2000); }, manual);
    } else {
      manual();
    }
  }

  function make(what, text, target) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy this ' + what);
    button.addEventListener('click', function () { copy(button, text(), target); });
    return button;
  }

  function enhance(root) {
    root = root || document;
    root.querySelectorAll('.code').forEach(function (box) {
      var pre = box.querySelector('pre');
      if (!pre || box.querySelector('button.copy')) return;
      box.insertBefore(make(box.getAttribute('data-what') || 'code', function () { return pre.textContent; }, pre), pre);
    });
    root.querySelectorAll('code.cmd').forEach(function (code) {
      if (code.nextElementSibling && code.nextElementSibling.classList.contains('copy')) return;
      var button = make(code.getAttribute('data-what') || 'command', function () { return code.textContent; }, code);
      button.classList.add('inline');
      code.parentNode.insertBefore(button, code.nextSibling);
    });
  }

  window.lifeisCopy = { copy: copy, enhance: enhance };
  enhance(document);
})();
