import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Scanner from '../components/Scanner';
import PlacePicker from '../components/PlacePicker';
import { shrink } from '../components/shrink';
import { inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

const ICONS = { film: '🎬', show: '📺', music: '🎵', book: '📚', game: '🎮', other: '🗃' };
// What a copy is on when the look-up didn't say.
const USUAL_FORMAT = { film: 'DVD', show: 'DVD', music: 'CD', game: 'Game', other: 'Other' };
const SAME_SCAN_MS = 3000;

/**
 * Filling one place: scan, or type, one thing after another, and each goes here. Something you already have
 * is moved here (its history remembers where from); something new is looked up where it can be and added;
 * a place's sticker switches to that place. Nothing is asked between scans unless a name is needed.
 */
export default function FillPlace() {
  const navigate = useNavigate();
  const placeId = Number(useParams().id);
  const [places, setPlaces] = useState(null);
  const [kinds, setKinds] = useState(null);
  const [kindId, setKindId] = useState('');
  const [bookFormat, setBookFormat] = useState('Paperback');
  const [can, setCan] = useState(null);
  const [log, setLog] = useState([]);              // newest first: { key, icon, text, note, tone, item_id, media_id, ask }
  const [typed, setTyped] = useState('');
  const [round, setRound] = useState(0);
  const last = useRef({ code: '', at: 0 });
  const busy = useRef(Promise.resolve());

  const loadKinds = useCallback(() => axios.get('/api/things/kinds').then(({ data }) => {
    setKinds(data);
    setKindId((now) => now || (data.find((k) => /household|stuff|things/i.test(k.name)) ?? data[0])?.id || '');
  }), []);
  useEffect(() => {
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => setPlaces([]));
    loadKinds().catch(() => setKinds([]));
    axios.get('/api/lookups').then(({ data }) => setCan(data)).catch(() => setCan({}));
  }, [loadKinds]);

  const place = places?.find((p) => p.id === placeId);
  const note = (entry) => {
    const key = `${Date.now()}-${Math.random()}`;
    setLog((list) => [{ key, ...entry }, ...list].slice(0, 200));
    return key;
  };
  const change = (key, patch) => setLog((list) => list.map((e) => (e.key === key ? { ...e, ...patch } : e)));

  /** A new thing, here. */
  const addThing = async (name, extra = {}) => (await axios.post('/api/things/items', { kind_id: Number(kindId), name, place_id: placeId, ...extra })).data;
  /** A new title with its copy, here. */
  const addTitle = async (start, format, barcode) => (await axios.post('/api/media', { ...start, copy: { format, place_id: placeId, barcode } })).data;

  /** What a new barcode is, from outside, when looking that kind of thing up is turned on. */
  const lookUp = async (barcode, isbn) => {
    if (isbn && can?.books) {
      const { data: { book } } = await axios.get('/api/lookups/book', { params: { code: barcode } });
      return book ? { type: 'book', title: book.title, creator: book.creator || null, genres: book.genres || [] } : null;
    }
    if (!isbn && can?.titles) {
      const { data: { title } } = await axios.get('/api/lookups/title', { params: { code: barcode } });
      return title ? { type: title.type, title: title.title, creator: title.creator, year: title.year, format: title.format } : null;
    }
    return null;
  };

  const handle = async (code) => {
    const { data } = await axios.get('/api/things/scan', { params: { code } });
    if (data.kind === 'place') {
      note({ icon: '📍', text: `Now filling ${data.place.path}`, tone: 'quiet' });
      navigate(`/things/places/${data.place.id}/fill`, { replace: true });
      return;
    }
    if (data.kind === 'thing') {
      const it = data.item;
      if (it.place_id === placeId) { note({ icon: it.icon || '📦', text: it.name, note: 'already here', tone: 'quiet', item_id: it.id }); return; }
      await axios.post(`/api/things/items/${it.id}/move`, { place_id: placeId });
      note({ icon: it.icon || '📦', text: it.name, note: it.place ? `moved here from ${it.place}` : 'put here', tone: 'moved', item_id: it.id });
      return;
    }
    if (data.kind === 'copies') {
      const away = data.copies.find((c) => c.place_id !== placeId);
      const shown = data.copies[0];
      if (!away) { note({ icon: ICONS[shown.type] ?? '🗃', text: shown.title, note: 'already here', tone: 'quiet', media_id: shown.media_id }); return; }
      await axios.post(`/api/media/copies/${away.copy_id}/move`, { place_id: placeId });
      note({ icon: ICONS[away.type] ?? '🗃', text: away.title, note: away.place ? `moved here from ${away.place}` : 'put here', tone: 'moved', media_id: away.media_id });
      return;
    }
    if (data.kind === 'new-sticker') {
      note({ icon: '🏷', text: 'A new sticker', note: 'what is it on?', tone: 'ask', ask: { code: data.code } });
      return;
    }
    // Not yours yet: looked up if that's turned on, else a name is asked for, keeping the barcode.
    // A look-up can take a while, so the scan shows at once and its line is filled in when the answer comes.
    const looking = (data.isbn ? can?.books : can?.titles) && true;
    const line = looking ? note({ icon: '🔎', text: `Barcode ${data.barcode}`, note: 'looking it up…', tone: 'quiet' }) : null;
    const say = (entry) => (line ? change(line, entry) : note(entry));
    let found = null;
    let trouble = null;
    try { found = await lookUp(data.barcode, data.isbn); } catch (err) { trouble = errorMessage(err, "It couldn't be looked up just now"); }
    try {
      if (found && found.type !== 'other') {
        const format = found.type === 'book' ? bookFormat : (found.format || USUAL_FORMAT[found.type]);
        const { format: _f, ...start } = found;
        const made = await addTitle(start, format, data.barcode);
        say({ icon: ICONS[found.type], text: found.title, note: `added · ${format}`, tone: 'added', media_id: made.id });
        return;
      }
      if (found) {
        const made = await addThing(found.title, { barcode: data.barcode });
        say({ icon: made.icon || '📦', text: made.name, note: 'added', tone: 'added', item_id: made.id, photo: true });
        return;
      }
    } catch (err) {
      say({ icon: '⚠️', text: `Barcode ${data.barcode}`, note: errorMessage(err, "Couldn't put that here"), tone: 'trouble' });
      return;
    }
    // Not looked up is not the same as not known: say which, and ask its name either way.
    say({ icon: '❔', text: `Barcode ${data.barcode}`, note: trouble ? `${trouble.replace(/\.$/, '')}. What is it?` : 'not known: what is it?', tone: 'ask', ask: { barcode: data.barcode, isbn: data.isbn } });
  };

  // One at a time, in the order they were scanned, and the same code twice in a moment only once.
  const take = useCallback((code) => {
    const now = Date.now();
    const same = code === last.current.code && now - last.current.at < SAME_SCAN_MS;
    last.current = { code, at: now };
    setTimeout(() => setRound((r) => r + 1), 900);
    if (same) return;
    busy.current = busy.current.then(() => handle(code)).catch((err) => note({ icon: '⚠️', text: code, note: errorMessage(err, "Couldn't put that here"), tone: 'trouble' }));
  }, [placeId, kindId, bookFormat, can]); // eslint-disable-line react-hooks/exhaustive-deps

  const typedIn = (e) => {
    e.preventDefault();
    const name = typed.trim();
    if (!name) return;
    setTyped('');
    busy.current = busy.current.then(async () => {
      const made = await addThing(name);
      note({ icon: made.icon || '📦', text: made.name, note: 'added', tone: 'added', item_id: made.id, photo: true });
    }).catch((err) => note({ icon: '⚠️', text: name, note: errorMessage(err, "Couldn't add that"), tone: 'trouble' }));
  };

  const turnOnLookups = async () => {
    const { data } = await axios.put('/api/lookups', { books: true, titles: true });
    setCan(data);
  };
  const makeHousehold = async () => { await axios.post('/api/things/kinds', { name: 'Household', icon: '🏠' }); await loadKinds(); };

  if (!places || !kinds) return null;
  if (!place) return <p className="text-sm text-gray-500 dark:text-life-300">That place isn't there any more. <Link to="/things/places" className="underline">All places</Link></p>;
  const lookupsOff = can?.available && (!can.books || !can.titles);
  const kind = kinds.find((k) => k.id === Number(kindId));

  return (
    <div className="space-y-4">
      <Link to={`/things/places/${placeId}`} className="text-sm text-life-600 hover:underline dark:text-life-200">← {place.name}</Link>
      <div>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Filling {place.name}</h1>
        {place.path !== place.name && <p className="text-xs text-gray-500 dark:text-life-300">{place.path}</p>}
        <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
          Scan each thing here, or type its name. What you already have is moved here; what's new is added. Scan another place's sticker to move on to it.
          {' '}<Link to={`/things/places/${placeId}/walk`} className="underline">Walk through what's here</Link> to add photos, values and serial numbers.
        </p>
      </div>

      <section className={`${cardClass} grid gap-3 sm:grid-cols-3`} aria-label="How new things go in">
        <label className="block space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">Filling
          <PlacePicker value={placeId} places={places} onPlaces={setPlaces} onChange={(id) => id && navigate(`/things/places/${id}/fill`, { replace: true })} />
        </label>
        <label className="block space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">New things are
          {kinds.length === 0 ? (
            <button type="button" onClick={makeHousehold} className={`${quietButtonClass} block w-full`}>Make a "Household" kind</button>
          ) : (
            <select value={kindId} onChange={(e) => setKindId(e.target.value)} className={inputClass}>
              {kinds.map((k) => <option key={k.id} value={k.id}>{k.icon ? `${k.icon} ` : ''}{k.name}</option>)}
            </select>
          )}
        </label>
        <label className="block space-y-1 text-xs font-medium text-gray-600 dark:text-life-200">Books here are
          <select value={bookFormat} onChange={(e) => setBookFormat(e.target.value)} className={inputClass}>
            {['Paperback', 'Hardcover', 'Board book', 'Comic', 'Magazine'].map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      </section>

      {lookupsOff && (
        <div className="space-y-2 rounded-xl border border-life-200 p-3 text-sm text-gray-700 dark:border-life-700 dark:text-life-100">
          <p>Turn on look-ups and scanned books, films, music and games fill themselves in. <span className="font-medium">What's sent:</span> only the number under each new barcode, to {[can.books ? null : can.service?.name, can.titles ? null : can.title_services?.name].filter(Boolean).join(' and ')}. No account, no key.</p>
          <button type="button" onClick={turnOnLookups} className={quietButtonClass}>Turn look-ups on</button>
        </div>
      )}

      {kinds.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className={cardClass}><Scanner key={round} onCode={take} label="Point the camera at a barcode or a sticker" /></div>
            <form onSubmit={typedIn} className="flex gap-2">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Something with no barcode"
                placeholder={`No barcode? Type it and press Enter: a new ${kind ? kind.name.toLowerCase() : 'thing'}`} className={inputClass} />
              <button type="submit" disabled={!typed.trim()} className={buttonClass}>Add</button>
            </form>
          </div>
          <section className={cardClass} aria-label="What happened">
            <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">This time <span className="text-sm font-normal text-gray-500 dark:text-life-300">{log.filter((e) => e.tone === 'added' || e.tone === 'moved').length || ''}</span></h2>
            {log.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">Nothing yet. Each scan shows up here.</p> : (
              <ul className="divide-y divide-life-50 dark:divide-life-700">
                {log.map((e) => <Row key={e.key} entry={e} onChange={(patch) => change(e.key, patch)} addThing={addThing} addTitle={addTitle} bookFormat={bookFormat} />)}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

const TONES = { added: 'text-life-700 dark:text-life-200', moved: 'text-honey-700 dark:text-honey-400', quiet: 'text-gray-500 dark:text-life-300', ask: 'text-life-700 dark:text-life-100', trouble: 'text-red-600' };

/** One scan's line: what it was and what was done, a photo for a new thing, and a name where one is needed. */
function Row({ entry, onChange, addThing, addTitle, bookFormat }) {
  const [name, setName] = useState('');
  const [as, setAs] = useState(entry.ask?.isbn ? 'book' : 'thing');
  const [error, setError] = useState('');
  const picker = useRef(null);

  const give = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError('');
    try {
      if (as === 'thing') {
        const made = await addThing(name.trim(), entry.ask.code ? { code: entry.ask.code } : { barcode: entry.ask.barcode });
        onChange({ icon: made.icon || '📦', text: made.name, note: 'added', tone: 'added', item_id: made.id, ask: null, photo: true });
      } else {
        const format = as === 'book' ? bookFormat : USUAL_FORMAT[as];
        const made = await addTitle({ type: as, title: name.trim() }, format, entry.ask.barcode ?? null);
        onChange({ icon: ICONS[as], text: made.title, note: `added · ${format}`, tone: 'added', media_id: made.id, ask: null });
      }
    } catch (err) { setError(errorMessage(err, "Couldn't add that")); }
  };
  const photo = async (file) => {
    if (!file) return;
    try { await axios.put(`/api/things/items/${entry.item_id}/photo`, { data: await shrink(file) }); onChange({ photo: 'kept' }); } catch (err) { setError(errorMessage(err, "The photo couldn't be kept")); }
  };

  const link = entry.item_id ? `/things/${entry.item_id}` : entry.media_id ? `/media/${entry.media_id}` : null;
  return (
    <li className="space-y-1.5 py-2 text-sm" data-tone={entry.tone}>
      <div className="flex items-baseline gap-2">
        <span aria-hidden="true">{entry.icon}</span>
        <span className="flex-1 text-gray-800 dark:text-life-50">{link ? <Link to={link} className="hover:underline">{entry.text}</Link> : entry.text}
          {entry.note && <span className={`ml-1.5 text-xs ${TONES[entry.tone] ?? ''}`}>{entry.note}</span>}
        </span>
        {entry.item_id && entry.photo && (
          <>
            <input ref={picker} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => photo(e.target.files?.[0])} />
            <button type="button" onClick={() => picker.current?.click()} aria-label={`A photo of ${entry.text}`} className="rounded px-1.5 text-base">{entry.photo === 'kept' ? '🖼' : '📷'}</button>
          </>
        )}
      </div>
      {entry.ask && (
        <form onSubmit={give} className="flex flex-wrap gap-2">
          {!entry.ask.code && (
            <select value={as} onChange={(e) => setAs(e.target.value)} aria-label="What it is" className="rounded-lg border border-life-200 bg-card px-2 py-1.5 text-sm dark:border-life-700 dark:bg-life-800 dark:text-life-50">
              <option value="thing">A thing</option><option value="book">A book</option><option value="film">A film</option><option value="music">Music</option><option value="game">A game</option>
            </select>
          )}
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Its name" placeholder="Its name" className={`${inputClass} min-w-0 flex-1`} />
          <button type="submit" disabled={!name.trim()} className={quietButtonClass}>Add</button>
        </form>
      )}
      {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
    </li>
  );
}
