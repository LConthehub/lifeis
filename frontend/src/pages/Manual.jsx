import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import PlacePicker from '../components/PlacePicker';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { onDevice, serverOrigin } from '../where';

const ICONS = { emergency: '🚨', contacts: '📞', house: '🏠', routines: '🗓' };
const telHref = (phone) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/**
 * The house manual: what someone else needs to know to look after the home. Written here, printed, or shared
 * by a link that needs no sign-in and stops working on a day you pick.
 */
export default function ManualPage() {
  const [manual, setManual] = useState(null);
  const [places, setPlaces] = useState([]);
  const [editing, setEditing] = useState(null);       // an entry, or { section, title } for a new one
  useEffect(() => {
    axios.get('/api/manual').then(({ data }) => setManual(data)).catch(() => setManual(false));
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
  }, []);
  if (manual === null) return null;
  if (manual === false) return <p className="text-sm text-gray-600 dark:text-life-200">The manual couldn't be opened just now.</p>;
  const written = manual.sections.reduce((n, s) => n + s.entries.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">House manual</h1>
        <button type="button" disabled={!written && !manual.pets.length} onClick={() => window.print()} className={quietButtonClass}>Print</button>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-100 print:hidden">
        What someone else needs to know to look after your home: a sitter, a guest, family, or you on the day something goes wrong.
        Tap an idea to start, and write it the way you'd say it.
      </p>
      {!onDevice() && <Sharing manual={manual} onChanged={setManual} />}

      <div className="report-sheet space-y-4">
        <h2 className="hidden text-lg font-bold text-black print:block">House manual</h2>
        {manual.sections.map((s) => (
          <section key={s.id} className={`${cardClass} break-inside-avoid-page print:bg-white print:p-0 print:shadow-none print:ring-0`} aria-label={s.title}>
            <div className="mb-1 flex items-baseline gap-2">
              <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50 print:text-black"><span aria-hidden="true">{ICONS[s.id]} </span>{s.title}</h2>
              <button type="button" onClick={() => setEditing({ section: s.id, title: '' })} className="text-sm text-life-600 hover:underline dark:text-life-200 print:hidden">+ Add</button>
            </div>
            {s.entries.length === 0 && <p className="text-sm text-gray-500 dark:text-life-300 print:hidden">{s.hint}</p>}
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {s.entries.map((e) => (
                <li key={e.id} className="break-inside-avoid py-2">
                  <div className="flex items-baseline gap-2">
                    <h3 className="flex-1 text-sm font-medium text-gray-800 dark:text-life-50 print:text-black">{e.title}
                      {e.private && <span className="ml-2 rounded bg-gray-100 px-1.5 text-[11px] font-normal text-gray-600 print:hidden">private: not on the shared link</span>}</h3>
                    <button type="button" onClick={() => setEditing(e)} className="text-xs text-life-600 hover:underline dark:text-life-200 print:hidden">Change</button>
                  </div>
                  {e.place && <p className="text-xs text-life-700 dark:text-life-200 print:text-black">📍 {e.place_id ? <Link to={`/things/places/${e.place_id}`} className="hover:underline print:no-underline">{e.place}</Link> : e.place}</p>}
                  {e.phone && <p className="text-sm"><a href={telHref(e.phone)} className="font-semibold text-life-700 underline dark:text-life-100 print:text-black print:no-underline">{e.phone}</a></p>}
                  {e.body && <p className="whitespace-pre-line text-sm text-gray-700 dark:text-life-100 print:text-black">{e.body}</p>}
                </li>
              ))}
            </ul>
            {s.ideas.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5 print:hidden" role="group" aria-label={`Ideas for ${s.title}`}>
                {s.ideas.map((idea) => <button key={idea} type="button" onClick={() => setEditing({ section: s.id, title: idea })} className="rounded-full bg-life-50 px-2.5 py-1 text-xs text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">+ {idea}</button>)}
              </div>
            )}
          </section>
        ))}

        <section className={`${cardClass} break-inside-avoid-page print:bg-white print:p-0 print:shadow-none print:ring-0`} aria-label="Pets">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50 print:text-black"><span aria-hidden="true">🐾 </span>Pets</h2>
          {manual.pets.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300 print:hidden">Pets you add under keeping show here by themselves, with their food and vet. <Link to="/things/pets" className="underline">Add a pet</Link></p> : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {manual.pets.map((p) => (
                <li key={p.id} className="break-inside-avoid py-2 text-sm text-gray-700 dark:text-life-100 print:text-black">
                  <h3 className="font-medium text-gray-800 dark:text-life-50 print:text-black"><Link to={`/things/pets/${p.id}`} className="hover:underline print:no-underline">{p.name}</Link>{p.species && <span className="font-normal text-gray-500 dark:text-life-300"> · {p.species}</span>}</h3>
                  {p.food && <p><span className="font-medium">Food:</span> {p.food}</p>}
                  {(p.vet_name || p.vet_phone) && <p><span className="font-medium">Vet:</span> {p.vet_name}{p.vet_name && p.vet_phone && ' · '}{p.vet_phone && <a href={telHref(p.vet_phone)} className="underline print:no-underline">{p.vet_phone}</a>}</p>}
                  {p.note && <p className="whitespace-pre-line">{p.note}</p>}
                  {!p.food && !p.vet_name && !p.vet_phone && !p.note && <p className="text-gray-500 dark:text-life-300 print:hidden">Nothing about their food or vet yet. <Link to={`/things/pets/${p.id}`} className="underline">Add it</Link></p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && (
        <Modal title={editing.id ? editing.title : 'For the manual'} onClose={() => setEditing(null)}>
          <EntryForm entry={editing} sections={manual.sections} places={places} onPlaces={setPlaces} onDone={(m) => { setManual(m); setEditing(null); }} />
        </Modal>
      )}
    </div>
  );
}

/** The link the manual is shared by: off until turned on, for a few days or until turned off. */
function Sharing({ manual, onChanged }) {
  const [days, setDays] = useState('7');
  const [pets, setPets] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const share = manual.share;
  const address = share.on ? `${serverOrigin()}/m/${share.token}` : '';
  const hidden = manual.sections.reduce((n, s) => n + s.entries.filter((e) => e.private).length, 0);
  const turnOn = async () => {
    setError('');
    try { onChanged((await axios.put('/api/manual/share', { days: days === '' ? null : Number(days), pets })).data); setCopied(false); } catch (err) { setError(errorMessage(err, "Couldn't make the link")); }
  };
  const turnOff = async () => { onChanged((await axios.delete('/api/manual/share')).data); };
  const copy = async () => { try { await navigator.clipboard.writeText(address); setCopied(true); } catch { setCopied(false); } };
  return (
    <section className={`${cardClass} space-y-2 print:hidden`} aria-label="Sharing">
      <div className="flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Share it by a link</h2>
        <span className={`rounded px-1.5 text-[11px] ${share.on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{share.on ? 'On' : 'Off'}</span>
      </div>
      {share.on ? (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">
            Anyone with this link can read the manual without signing in{share.expires_on ? `, until ${share.expires_on}` : ', until you turn it off'}. They can't change anything or see anything else.
            {hidden > 0 && ` ${hidden} private ${hidden === 1 ? 'entry is' : 'entries are'} left out.`}{!share.pets && ' Pets are left out.'}
          </p>
          <input readOnly value={address} aria-label="The link" onFocus={(e) => e.target.select()} className={`${inputClass} font-mono text-xs`} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className={quietButtonClass}>{copied ? 'Copied' : 'Copy the link'}</button>
            <a href={address} target="_blank" rel="noreferrer" className={quietButtonClass}>See what they'll see</a>
            <button type="button" onClick={turnOff} className={quietButtonClass}>Turn it off</button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-600 dark:text-life-100">For a sitter or a guest: a link that opens the manual on their phone with no sign-in. Entries you mark private (an alarm code) are never on it.</p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <label className="flex items-center gap-2">It works for
              <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="How long the link works" className={`${inputClass} !w-auto`}>
                <option value="1">a day</option><option value="3">3 days</option><option value="7">a week</option><option value="14">2 weeks</option><option value="30">a month</option><option value="">until I turn it off</option>
              </select>
            </label>
            {manual.pets.length > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={pets} onChange={(e) => setPets(e.target.checked)} className="accent-life-600" /> with the pets</label>}
            <button type="button" onClick={turnOn} className={buttonClass}>Make the link</button>
          </div>
        </>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
    </section>
  );
}

function EntryForm({ entry, sections, places, onPlaces, onDone }) {
  const [form, setForm] = useState({ section: entry.section, title: entry.title || '', body: entry.body || '', phone: entry.phone || '', place_id: entry.place_id ?? '', private: Boolean(entry.private) });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const body = { section: form.section, title: form.title, body: form.body || null, phone: form.phone || null, place_id: form.place_id === '' ? null : Number(form.place_id), private: form.private };
    try { onDone((entry.id ? await axios.put(`/api/manual/entries/${entry.id}`, body) : await axios.post('/api/manual/entries', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => { if (window.confirm(`Remove "${entry.title}"?`)) onDone((await axios.delete(`/api/manual/entries/${entry.id}`)).data); };
  const person = form.section === 'contacts';
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label={person ? 'Who *' : 'What *'}><input required autoFocus={!form.title} value={form.title} onChange={set('title')} className={inputClass} /></Field>
        <Field label="Part of the manual">
          <select value={form.section} onChange={set('section')} className={inputClass}>{sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
        </Field>
      </div>
      <Field label={person ? 'Anything to know about them' : 'What to know'}>
        <textarea rows={4} autoFocus={Boolean(form.title) && !entry.id} value={form.body} onChange={set('body')} placeholder={person ? 'Ask for Dana. Has a key.' : 'The red lever behind the water heater: turn it a quarter.'} className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="A phone number"><input type="tel" value={form.phone} onChange={set('phone')} className={inputClass} /></Field>
        {!person && <Field label="Where it is"><PlacePicker value={form.place_id} places={places} onPlaces={onPlaces} onChange={(id) => setForm((f) => ({ ...f, place_id: id }))} /></Field>}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
        <input type="checkbox" checked={form.private} onChange={(e) => setForm({ ...form, private: e.target.checked })} className="accent-life-600" /> Private: keep it off the shared link
      </label>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center justify-between">
        {entry.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}
