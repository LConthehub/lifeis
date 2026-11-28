import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { CopyLine } from './Copy';
import { OnOffBox } from './OnOff';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

// Settings → Connections, behind More: letting an AI app read (and, if allowed, add to) this Life Is.
// Off for the household until the person in charge turns it on. Nothing here shows anywhere else.
const tall = 'min-h-[44px]';
const input = `${inputClass} ${tall}`;
const solid = `${buttonClass} ${tall}`;
const quiet = `${quietButtonClass} ${tall}`;
const danger = `${quiet} !border-red-300 !text-red-700 dark:!text-red-300`;

/** A day ("2026-11-25") or a moment, as words for this person. */
export const dayWords = (value) => {
  if (!value) return '';
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const date = day ? new Date(y, m - 1, d) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

/** The boxes for what a connection may see. All unticked at first; money carries its own warning. */
export function SectionTicks({ sections, value, onChange, name = 'sections' }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="space-y-1">
      <legend className="text-xs font-medium text-gray-600 dark:text-life-200">What it may see</legend>
      {sections.map((s) => (
        <div key={s.id}>
          <label className="flex min-h-[44px] items-start gap-3 py-1.5 text-sm text-gray-800 dark:text-life-50">
            <input type="checkbox" name={name} value={s.id} checked={value.includes(s.id)} onChange={() => toggle(s.id)} className="mt-0.5 h-5 w-5 flex-none" />
            <span>{s.title} <span className="block text-xs text-gray-500 dark:text-life-300">{s.says}</span></span>
          </label>
          {s.warning && <p className="ml-8 text-xs text-honey-700" data-warning={s.id}>{s.warning}</p>}
        </div>
      ))}
    </fieldset>
  );
}

export function ConnectorService() {
  const [c, setC] = useState(null);
  const [editing, setEditing] = useState(null); // { id, name, sections, may_add }
  const [cutting, setCutting] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { axios.get('/api/connector').then(({ data }) => setC(data)).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  if (!c) return null;

  const run = async (work, done) => {
    setMessage(null); setBusy(true);
    try { setC((await work()).data); if (done) setMessage({ ok: done }); } catch (err) { setMessage({ error: errorMessage(err, "That didn't work. Try again in a moment.") }); }
    setBusy(false);
  };
  const names = Object.fromEntries(c.sections.map((s) => [s.id, s.title]));
  const seeing = (conn) => (conn.sections.length ? conn.sections.map((id) => names[id] ?? id).join(', ') : 'Nothing yet');
  const save = (e) => {
    e.preventDefault();
    run(() => axios.put(`/api/connector/connections/${editing.id}`, { name: editing.name, sections: editing.sections, may_add: editing.may_add }), 'Saved.')
      .then(() => setEditing(null));
  };

  return (
    <div className="py-3" data-connector>
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">Use Life Is from your AI app</h3>
        <span className={`rounded px-1.5 text-[11px] ${c.household_on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{c.household_on ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        An AI app, such as Claude, can look at parts of your Life Is that you pick, and add a few things if you let it. <span className="font-medium">What it does:</span> {c.service.sends}
      </p>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">{c.never}</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">A connection ends by itself if you don't use it for {c.unused_days} days.</p>

      {!c.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This can't be tried in the demo.</p> : (
        <div className="mt-3 space-y-4">
          <OnOffBox
            name="connector-on" label="Turn on use from an AI app" checked={c.household_on} disabled={!c.is_admin || busy}
            why={c.is_admin ? '' : "Only the person in charge of this Life Is can change this."}
            onChange={(on) => {
              if (!on && !window.confirm('Turn this off for everyone? Every connected AI app is cut off at once.')) return;
              run(() => axios.put('/api/connector/household', { on }));
            }} />

          {c.household_on && (
            <>
              {c.reach.ok ? (
                <div className="space-y-1 text-sm text-gray-800 dark:text-life-50" data-reach="ok">
                  <p>Paste this address into your AI app:</p>
                  <CopyLine text={c.address} what="the address" />
                </div>
              ) : (
                <div className="space-y-1 text-sm text-honey-700" data-reach="no">
                  <p>{c.reach.why} The install guide says how to reach your Life Is from outside your home.</p>
                  <p><a href="https://lifeis.living/docs/install.html" target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center underline">Read the install guide</a></p>
                </div>
              )}
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-gray-700 dark:text-life-100">
                <li>Paste the address in your AI app.</li>
                <li>Sign in to Life Is when the app sends you here.</li>
                <li>Name the connection and check what it may see.</li>
              </ol>

              {message && <p className={`text-sm ${message.error ? 'text-red-600' : 'text-life-700 dark:text-life-200'}`} role={message.error ? 'alert' : 'status'}>{message.error || message.ok}</p>}

              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-life-100">Your connections</h4>
                {c.connections.length === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-life-100">No AI app is connected.</p> : (
                  <ul className="mt-1 space-y-3" aria-label="Your connections">
                    {c.connections.map((conn) => (
                      <li key={conn.id} className="space-y-2 rounded-xl border border-life-100 p-3 dark:border-life-700" data-connection={conn.id}>
                        {editing?.id === conn.id ? (
                          <form onSubmit={save} className="space-y-3" aria-label={`Change ${conn.name}`}>
                            <Field label="Its name"><input value={editing.name} maxLength={60} required onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} /></Field>
                            <SectionTicks sections={c.sections} value={editing.sections} onChange={(sections) => setEditing({ ...editing, sections })} name="edit-sections" />
                            <label className="flex min-h-[44px] items-start gap-3 text-sm text-gray-800 dark:text-life-50">
                              <input type="checkbox" checked={editing.may_add} onChange={(e) => setEditing({ ...editing, may_add: e.target.checked })} className="mt-0.5 h-5 w-5 flex-none" />
                              <span>It may add things <span className="block text-xs text-gray-500 dark:text-life-300">{c.adds}</span></span>
                            </label>
                            <div className="flex flex-wrap gap-2">
                              <button type="submit" disabled={busy} className={solid}>Save</button>
                              <button type="button" onClick={() => setEditing(null)} className={quiet}>Not now</button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                              <span className="font-medium text-gray-900 dark:text-life-50">{conn.name}</span>
                              <span className="text-xs text-gray-600 dark:text-life-200">{conn.app_name}</span>
                            </div>
                            <p className="text-sm text-gray-700 dark:text-life-100">May see: {seeing(conn)}</p>
                            <p className="text-sm text-gray-700 dark:text-life-100">{conn.may_add ? 'It may add things.' : 'It may not add things.'}</p>
                            <p className="text-xs text-gray-600 dark:text-life-200">{conn.last_used_on ? `Last used ${dayWords(conn.last_used_on)}` : 'Never used'}. Ends by itself on {dayWords(conn.ends_on)} if it isn't used.</p>
                            {cutting === conn.id ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm text-gray-800 dark:text-life-50">Cut off "{conn.name}"? It stops working at once.</span>
                                <button type="button" disabled={busy} onClick={() => run(() => axios.delete(`/api/connector/connections/${conn.id}`), `Cut off "${conn.name}".`).then(() => setCutting(null))} className={danger}>Yes, cut it off</button>
                                <button type="button" onClick={() => setCutting(null)} className={quiet}>Keep it</button>
                              </div>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => { setEditing({ id: conn.id, name: conn.name, sections: conn.sections, may_add: conn.may_add }); setMessage(null); }} className={quiet} aria-label={`Change ${conn.name}`}>Change</button>
                                <button type="button" onClick={() => setCutting(conn.id)} className={danger} aria-label={`Cut off ${conn.name}`}>Cut off</button>
                              </div>
                            )}
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h4 className="text-sm font-medium text-gray-700 dark:text-life-100">What it has done</h4>
                {c.log.length === 0 ? <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Nothing yet. Lines are kept for 90 days.</p> : (
                  <ul className="mt-1 divide-y divide-life-100 text-sm dark:divide-life-700" aria-label="What it has done">
                    {c.log.map((line) => (
                      <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-log={line.id}>
                        <span className="min-w-0 flex-1 text-gray-800 dark:text-life-50">
                          <span className="block text-xs text-gray-500 dark:text-life-300">{dayWords(line.at)} · {line.connection}</span>
                          {line.what}
                        </span>
                        {line.undone ? <span className="text-xs font-medium text-gray-600 dark:text-life-200">Undone</span>
                          : line.can_undo && <button type="button" disabled={busy} onClick={() => run(() => axios.post(`/api/connector/log/${line.id}/undo`), 'Undone.')} className={quiet}>Undo</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
