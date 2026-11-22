// The setup builder on /docs/install. Runs only in your browser: nothing you type is sent anywhere.
// It writes a docker-compose.yml from the choices on the page.
(function () {
  'use strict';
  var form = document.getElementById('setup');
  if (!form) return;
  var out = document.getElementById('compose');
  var steps = document.getElementById('steps');
  var IMAGE = form.getAttribute('data-image');

  function val(name) {
    var el = form.elements[name];
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return (el.value || '').trim();
  }
  // A path as Docker Compose wants it: forward slashes, quoted (paths can have spaces).
  function path(p) { return p.replace(/\\/g, '/').replace(/\/+$/, ''); }
  function q(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
  function num(name, fallback, min, max) {
    var n = parseInt(val(name), 10);
    return isNaN(n) ? fallback : Math.max(min, Math.min(max, n));
  }
  function host(text) { return text.replace(/^https?:\/\//i, '').replace(/[\/\s].*$/, '').toLowerCase(); }

  function build() {
    var port = num('port', 8020, 1, 65535);
    var store = val('store');                       // "docker" or "folders"
    var dataFolder = path(val('data_folder'));
    var keysFolder = path(val('keys_folder'));
    var reach = val('reach');                       // "computer", "network" or "web"
    var web = reach === 'web' ? host(val('web_address')) : '';
    var idle = num('idle', 15, 0, 1440);
    var media = val('media');
    var folders = store === 'folders' && dataFolder && keysFolder;

    var y = [];
    y.push('# Made with the setup builder at lifeis.living/docs/install');
    y.push('# Start it:  docker compose up -d      Update it:  docker compose pull, then docker compose up -d');
    if (!folders) y.push('# Your records are kept by Docker (lifeis_data and lifeis_keys). Never run "docker compose down -v": the -v deletes them.');
    y.push('');
    y.push('name: lifeis');
    y.push('');
    y.push('services:');
    y.push('  lifeis:');
    y.push('    image: ' + IMAGE);
    y.push('    ports:');
    // With a web address, only the small web server faces outward; Life Is itself answers this computer alone.
    y.push('      - ' + q((reach === 'network' ? '' : '127.0.0.1:') + port + ':8008') + (reach === 'network' ? '        # any device on your home network' : '     # this computer only'));
    y.push('    volumes:');
    y.push('      - ' + (folders ? q(dataFolder + ':/data') : 'lifeis_data:/data') + '        # your records, encrypted');
    y.push('      - ' + (folders ? q(keysFolder + ':/keys') : 'lifeis_keys:/keys') + '        # the key that opens them, kept apart');
    y.push('    environment:');
    y.push('      - SESSION_IDLE_MINUTES=' + idle + (idle === 0 ? '        # never signs out by itself' : '       # signs out after this long unused'));
    if (media) {
      y.push('    extra_hosts:');
      y.push('      - "host.docker.internal:host-gateway"     # so a Jellyfin or Immich on this same computer can be reached');
    }
    y.push('    restart: unless-stopped');
    if (web) {
      y.push('');
      y.push('  # A small web server that gets a certificate by itself, so Life Is opens at https://' + web);
      y.push('  caddy:');
      y.push('    image: caddy:2');
      y.push('    command: caddy reverse-proxy --from ' + web + ' --to lifeis:8008');
      y.push('    ports:');
      y.push('      - "80:80"');
      y.push('      - "443:443"');
      y.push('    volumes:');
      y.push('      - caddy_data:/data');
      y.push('    depends_on:');
      y.push('      - lifeis');
      y.push('    restart: unless-stopped');
    }
    var volumes = [];
    if (!folders) { volumes.push('  lifeis_data:'); volumes.push('  lifeis_keys:'); }
    if (web) volumes.push('  caddy_data:');
    if (volumes.length) { y.push(''); y.push('volumes:'); y = y.concat(volumes); }
    out.value = y.join('\n') + '\n';

    // What to do with it, in the person's own words and numbers.
    var list = [];
    list.push('Save the file above as <code>docker-compose.yml</code> in your Life Is folder.');
    if (store === 'folders' && !folders) list.push('<strong>Fill in both folders above</strong>, or choose "Kept by Docker". Until then the file keeps your records with Docker.');
    list.push('Open a terminal in that folder and run <code>docker compose up -d</code>. The first start downloads Life Is, which takes a few minutes.');
    list.push('On this computer, open <a href="http://localhost:' + port + '">http://localhost:' + port + '</a> and make your account. The first account is the admin.');
    if (reach === 'network') list.push('From a phone or tablet at home, open <code>http://</code> this computer\'s address <code>:' + port + '</code>. The camera will not scan there: browsers only allow it over https.');
    if (web) list.push('Then open <a href="https://' + web + '">https://' + web + '</a> from anywhere. The first visit can take a minute while the certificate is fetched.');
    steps.innerHTML = list.map(function (s) { return '<li>' + s + '</li>'; }).join('');

    form.querySelectorAll('[data-when]').forEach(function (el) {
      var parts = el.getAttribute('data-when').split('=');
      el.hidden = val(parts[0]) !== parts[1];
    });
  }

  form.addEventListener('input', build);
  form.addEventListener('change', build);
  document.getElementById('copy-compose').addEventListener('click', function (e) {
    var button = e.target;
    function said() { button.textContent = 'Copied'; setTimeout(function () { button.textContent = 'Copy'; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(out.value).then(said, function () { out.select(); });
    else { out.select(); document.execCommand('copy'); said(); }
  });
  document.getElementById('download-compose').addEventListener('click', function () {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([out.value], { type: 'text/yaml' }));
    link.download = 'docker-compose.yml';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
  var note = document.getElementById('no-script');
  if (note) note.hidden = true;
  build();
})();
