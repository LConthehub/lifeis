import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from './ui';

// What each book server asks for. The same words are in core/'s libraries.ts.
export const BOOK_SERVERS = {
  audiobookshelf: { name: 'Audiobookshelf', address: 'http://192.168.1.20:13378', key: 'API token', hint: 'In Audiobookshelf: Settings, then Users, then your user. Copy the API token.' },
  calibre: { name: 'Calibre', address: 'http://192.168.1.20:8080', login: true, optional: true, hint: 'In Calibre: Connect/share, then Start Content server. A username and password only if you have set it to ask for them.' },
  'calibre-web': { name: 'Calibre-Web', address: 'http://192.168.1.20:8083', login: true, hint: 'Your Calibre-Web username and password. Life Is reads its catalog at /opds, which that user must be allowed to see.' },
  kavita: { name: 'Kavita', address: 'http://192.168.1.20:5000', key: 'API key', hint: 'In Kavita: your user settings, then 3rd Party Clients (or API key / OPDS). Copy the API key.' },
  opds: { name: 'Another catalog (OPDS)', address: 'http://192.168.1.20:8080/opds/books', login: true, optional: true, hint: 'For Calibre, Komga, COPS and others: the address of a list of books, not of a menu. A username and password only if it asks for them.' },
};
const EVERY = [[0, 'Only when I ask'], [1, 'Every hour'], [6, 'Every 6 hours'], [24, 'Once a day'], [168, 'Once a week']];
const when = (stamp) => (stamp ? new Date(stamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);
export const bookServerName = (kind) => BOOK_SERVERS[kind]?.name ?? kind;

/** Book servers of your own, whose libraries are brought into Books, eBooks and Audiobooks and kept in step. */
export default function BookServers() {
  const [servers, setServers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const load = useCallback(() => { axios.get('/api/libraries').then(({ data }) => setServers(data)).catch(() => setServers([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!servers) return null;
  const sync = async (s) => {
    setBusy(s.id);
    setMessage(null);
    try {
      const { data } = await axios.post(`/api/libraries/${s.id}/sync`);
      setServers(data.libraries);
      const parts = [`${data.total} on ${s.name}`, data.added && `${data.added} added`, data.removed && `${data.removed} gone`, data.covers && `${data.covers} covers kept`].filter(Boolean);
      setMessage({ ok: `In step: ${parts.join(', ')}.` });
    } catch (err) {
      setMessage({ error: errorMessage(err, "Couldn't sync") });
      load();
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-4" aria-labelledby="book-servers">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="book-servers" className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Book servers</h2>
        <button type="button" onClick={() => setEditing({})} className={buttonClass}>+ Connect a book server</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-200">
        Bring in your Calibre, Calibre-Web, Kavita or Audiobookshelf library, so every book you have is in one place: on the shelf, on a server, or both.
        Each one keeps a link that opens it on its server. Life Is only reads: nothing on the server is ever changed.
        Kindle, Apple Books and Google Play Books can't be read this way; for those, bring in a list from Books.
      </p>
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-life-50 text-life-800 dark:bg-life-700 dark:text-life-50' : 'bg-red-50 text-red-700'}`}>{message.ok || message.error}</p>}
      {servers.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No book servers connected.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {servers.map((s) => (
            <section key={s.id} className={cardClass}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-life-800 dark:text-life-50">{s.name} {s.name !== bookServerName(s.kind) && <span className="text-xs font-normal text-gray-500 dark:text-life-300">{bookServerName(s.kind)}</span>}</h3>
                  <p className="truncate text-xs text-gray-500 dark:text-life-300">{s.url}</p>
                </div>
                <button type="button" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`} className="text-xs text-life-600 hover:underline dark:text-life-200">Edit</button>
              </div>
              <p className="mt-2 text-sm text-gray-700 dark:text-life-100">{s.copies} in the collection · {(EVERY.find(([h]) => h === s.every_hours) || EVERY[0])[1].toLowerCase()}</p>
              <p className={`text-xs ${s.last_ok === false ? 'text-red-600' : 'text-gray-500 dark:text-life-300'}`}>
                {s.last_sync_at ? `${s.last_ok ? 'Synced' : 'Tried'} ${when(s.last_sync_at)}: ${s.last_message}` : 'Not synced yet.'}
              </p>
              <button type="button" disabled={busy === s.id} onClick={() => sync(s)} className={`${quietButtonClass} mt-3`}>{busy === s.id ? 'Syncing…' : 'Sync now'}</button>
            </section>
          ))}
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? editing.name : 'Connect a book server'} onClose={() => setEditing(null)}>
          <BookServerForm server={editing} onDone={(data) => { setServers(data); setEditing(null); }} />
        </Modal>
      )}
    </section>
  );
}

function BookServerForm({ server, onDone }) {
  const [form, setForm] = useState({ kind: server.kind || 'audiobookshelf', url: server.url || '', key: '', username: '', password: '', name: server.name || '', every_hours: server.every_hours ?? 24, with_copies: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const needs = BOOK_SERVERS[form.kind];
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { kind: form.kind, url: form.url, key: form.key || null, username: form.username || null, password: form.password || null, name: form.name || null, every_hours: Number(form.every_hours) };
    try {
      onDone((server.id ? await axios.put(`/api/libraries/${server.id}`, body) : await axios.post('/api/libraries', body)).data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    const what = form.with_copies ? `Disconnect ${server.name} and take what it brought in out of the collection? Books you've logged or own another copy of stay.`
      : `Disconnect ${server.name}? What it brought in stays in the collection.`;
    if (!window.confirm(what)) return;
    try { onDone((await axios.delete(`/api/libraries/${server.id}`, { params: form.with_copies ? { with_copies: 1 } : {} })).data); } catch (err) { setError(errorMessage(err, "Couldn't disconnect")); }
  };
  const must = !server.id && !needs.optional;
  return (
    <form onSubmit={submit} className="space-y-3">
      {!server.id && (
        <Field label="What it is">
          <select value={form.kind} onChange={set('kind')} className={inputClass}>{Object.entries(BOOK_SERVERS).map(([id, s]) => <option key={id} value={id}>{s.name}</option>)}</select>
        </Field>
      )}
      <Field label="Its address *"><input required autoFocus={!server.id} type="url" value={form.url} onChange={set('url')} placeholder={needs.address} className={inputClass} /></Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        If it is on the same computer as Life Is, and Life Is runs in Docker, use <code>http://host.docker.internal</code> and its port: inside Docker, "localhost" means Life Is itself.
      </p>
      {needs.key ? (
        <Field label={server.id ? `A new ${needs.key} (empty: keep the saved one)` : `Its ${needs.key} *`}>
          <input required={must} type="password" autoComplete="off" value={form.key} onChange={set('key')} className={inputClass} />
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label={server.id ? 'Username (empty: keep)' : `Username${must ? ' *' : ''}`}><input required={must} autoComplete="off" value={form.username} onChange={set('username')} className={inputClass} /></Field>
          <Field label="Password"><input type="password" autoComplete="off" value={form.password} onChange={set('password')} className={inputClass} /></Field>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-life-300">{needs.hint} It is stored locked on this computer and is never shown again.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Keep in step">
          <select value={form.every_hours} onChange={set('every_hours')} className={inputClass}>{EVERY.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select>
        </Field>
        <Field label="What to call it"><input value={form.name} onChange={set('name')} placeholder={needs.name} className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {server.id ? (
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Disconnect</button>
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-life-200">
              <input type="checkbox" checked={form.with_copies} onChange={(e) => setForm({ ...form, with_copies: e.target.checked })} className="accent-life-600" /> and take what it brought in out of the collection
            </label>
          </span>
        ) : <span />}
        <button type="submit" disabled={saving} className={buttonClass}>{saving ? 'Checking…' : server.id ? 'Save' : 'Connect'}</button>
      </div>
    </form>
  );
}
