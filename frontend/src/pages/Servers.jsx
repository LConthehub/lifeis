import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import BookServers from '../components/BookServers';
import { CopyLine } from '../components/Copy';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

const KINDS = [['jellyfin', 'Jellyfin'], ['emby', 'Emby']];
const EVERY = [[0, 'Only when I ask'], [1, 'Every hour'], [6, 'Every 6 hours'], [24, 'Once a day'], [168, 'Once a week']];
const kindName = (kind) => (KINDS.find(([id]) => id === kind) || ['', kind])[1];
const when = (stamp) => (stamp ? new Date(stamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null);

/** The media servers whose libraries are brought into the collection, and kept in step. */
export default function Servers() {
  const [servers, setServers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const load = useCallback(() => { axios.get('/api/connections').then(({ data }) => setServers(data)).catch(() => setServers([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!servers) return null;
  const sync = async (s) => {
    setBusy(s.id);
    setMessage(null);
    try {
      const { data } = await axios.post(`/api/connections/${s.id}/sync`);
      setServers(data.connections);
      const parts = [`${data.total} on ${s.name}`, data.added && `${data.added} added`, data.removed && `${data.removed} gone`, data.covers && `${data.covers} covers kept`].filter(Boolean);
      const joined = data.joined_parts > 0 ? ` Joined ${data.joined_parts} ${data.joined_parts === 1 ? 'part' : 'parts'} into ${data.joined_books} ${data.joined_books === 1 ? 'book' : 'books'}.` : '';
      setMessage({ ok: `In step: ${parts.join(', ')}.${joined}` });
    } catch (err) {
      setMessage({ error: errorMessage(err, "Couldn't sync") });
      load();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Connections</h1>
          <p className="text-sm text-gray-600 dark:text-life-200">Your book and media servers</p>
        </div>
        <button type="button" onClick={() => setEditing({})} className={buttonClass}>+ Connect a server</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-200">
        Import your Jellyfin or Emby library into the collection, beside your tapes, discs, records and books. A film you also own on disc
        becomes one title with both copies. Life Is only reads from the server: nothing on it is ever changed.
      </p>
      <p className="text-sm text-gray-600 dark:text-life-200">
        To see everything Life Is can reach outside, and to turn any of it off, open <Link to="/settings/connections" className="underline">Connections in Settings</Link>.
      </p>
      {message && <p className={`rounded-lg px-3 py-2 text-sm ${message.ok ? 'bg-life-50 text-life-800 dark:bg-life-700 dark:text-life-50' : 'bg-red-50 text-red-700'}`}>{message.ok || message.error}</p>}
      {servers.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No servers connected.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {servers.map((s) => (
            <section key={s.id} className={cardClass}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-life-800 dark:text-life-50">{s.name} <span className="text-xs font-normal text-gray-500 dark:text-life-300">{kindName(s.kind)}</span></h2>
                  <p className="truncate text-xs text-gray-500 dark:text-life-300">{s.url}</p>
                </div>
                <button type="button" onClick={() => setEditing(s)} className="text-xs text-life-600 hover:underline dark:text-life-200">Edit</button>
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
        <Modal title={editing.id ? editing.name : 'Connect a media server'} onClose={() => setEditing(null)}>
          <ServerForm server={editing} onDone={(data) => { setServers(data); setEditing(null); }} />
        </Modal>
      )}
      <hr className="border-life-100 dark:border-life-700" />
      <BookServers />
    </div>
  );
}

function ServerForm({ server, onDone }) {
  const [form, setForm] = useState({ kind: server.kind || 'jellyfin', url: server.url || '', secret: '', name: server.name || '', every_hours: server.every_hours ?? 6, with_copies: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const product = kindName(form.kind);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const body = { kind: form.kind, url: form.url, secret: form.secret || null, name: form.name || null, every_hours: Number(form.every_hours) };
    try {
      onDone((server.id ? await axios.put(`/api/connections/${server.id}`, body) : await axios.post('/api/connections', body)).data);
    } catch (err) {
      setError(errorMessage(err, "Couldn't save"));
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    const what = form.with_copies ? `Disconnect ${server.name} and take what it imported out of the collection? Titles you've logged or own another copy of stay.`
      : `Disconnect ${server.name}? What it imported stays in the collection.`;
    if (!window.confirm(what)) return;
    try { onDone((await axios.delete(`/api/connections/${server.id}`, { params: form.with_copies ? { with_copies: 1 } : {} })).data); } catch (err) { setError(errorMessage(err, "Couldn't disconnect")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      {!server.id && (
        <Field label="What it is">
          <select value={form.kind} onChange={set('kind')} className={inputClass}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </Field>
      )}
      <Field label="Its address *"><input required autoFocus={!server.id} type="url" value={form.url} onChange={set('url')} placeholder="http://192.168.1.20:8096" className={inputClass} /></Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        If {product} is on the same computer as Life Is, and Life Is runs in Docker, use the address below: inside Docker, "localhost" means Life Is itself.
      </p>
      <CopyLine text="http://host.docker.internal:8096" what="the Docker address" />
      <Field label={server.id ? 'A new key (empty: keep the saved one)' : 'A key *'}>
        <input required={!server.id} type="password" autoComplete="off" value={form.secret} onChange={set('secret')} className={inputClass} />
      </Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        In {product}: Dashboard, then API Keys, then the + button. The key is stored locked on this computer and is never shown again.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Keep in step">
          <select value={form.every_hours} onChange={set('every_hours')} className={inputClass}>{EVERY.map(([hours, label]) => <option key={hours} value={hours}>{label}</option>)}</select>
        </Field>
        <Field label="What to call it"><input value={form.name} onChange={set('name')} placeholder="The server's own name" className={inputClass} /></Field>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {server.id ? (
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Disconnect</button>
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-life-200">
              <input type="checkbox" checked={form.with_copies} onChange={(e) => setForm({ ...form, with_copies: e.target.checked })} className="accent-life-600" /> and take what it imported out of the collection
            </label>
          </span>
        ) : <span />}
        <button type="submit" disabled={saving} className={buttonClass}>{saving ? 'Checking…' : server.id ? 'Save' : 'Connect'}</button>
      </div>
    </form>
  );
}
