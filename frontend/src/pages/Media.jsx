import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Scanner from '../components/Scanner';
import PlacePicker from '../components/PlacePicker';
import BookList from '../components/BookList';
import { bookServerName } from '../components/BookServers';
import { HistoryList } from './Thing';
import { stickerCode } from './Places';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, minutesText } from '../components/ui';

export const TYPES = [['film', 'Films', '🎬', 'Film'], ['show', 'Shows', '📺', 'Show'], ['music', 'Music', '🎵', 'Music'], ['book', 'Books', '📚', 'Book'], ['game', 'Games', '🎮', 'Game'], ['other', 'Other', '🗃', 'Something else']];
const typeOf = (type) => TYPES.find(([id]) => id === type) || TYPES[5];
const CREATOR = { film: 'Director', show: 'Made by', music: 'Artist', book: 'Author', game: 'Made by', other: 'Made by' };
const DID = { film: 'Watched', show: 'Watched', music: 'Listened', book: 'Read', game: 'Played', other: 'Enjoyed' };
// Covers are only shown when Life Is keeps them itself: pictures are never fetched from other sites by the page.
const localCover = (cover) => typeof cover === 'string' && cover.startsWith('/api/');
/**
 * What the button that follows a copy's link says: where it opens. A link is only ever followed when pressed.
 */
export function opensIn(link, source) {
  if (!link) return null;
  if (/^kindle:|read\.amazon\.|amazon\.[a-z.]+\/(kindle|gp\/product|dp)/i.test(link)) return 'Kindle';
  if (/^(ibooks|applebooks):|books\.apple\.com/i.test(link)) return 'Apple Books';
  if (/play\.google\.com\/(store\/)?books/i.test(link)) return 'Google Play Books';
  if (/^audible:|audible\.[a-z.]+\//i.test(link)) return 'Audible';
  if (/kobo\.com/i.test(link)) return 'Kobo';
  if (source && source !== 'list') return sourceName(source);
  try { return new URL(link).host; } catch { return 'its app'; }
}
const SOURCES = { jellyfin: 'Jellyfin', emby: 'Emby', list: 'a list' };
const sourceName = (source) => SOURCES[source] ?? bookServerName(source);
const commaList = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);
// A book you listen to: an audiobook by name, or a book on CD, tape, cassette, MP3 or a record.
const isAudio = (format) => /audio|audible|\b(cd|cds|mp3|tape|tapes|cassette|cassettes|vinyl|record|records|lp|playaway)\b/i.test(format);
const isEbook = (format) => /e-?book|kindle|kobo|epub|nook/i.test(format);

/**
 * The libraries a book can be in, told apart by what it's on. A book you have on paper and as an audiobook
 * is in both. One you only want, with no copy yet, is with the books.
 */
export const LIBRARIES = {
  books: {
    type: 'book', title: 'Books', fits: (m) => !m.formats.length || m.formats.some((f) => !isAudio(f) && !isEbook(f)),
    empty: "No books yet. Scan the barcode on the back (its ISBN) and Life Is looks up the title and author, then asks where it's kept: a room, and a shelf in it.",
  },
  ebooks: {
    type: 'book', title: 'eBooks', format: 'eBook', fits: (m) => m.formats.some(isEbook),
    empty: "No eBooks yet. Add one and say what it's on (eBook, Kindle, Kobo, anything you like), bring in a list from Goodreads, or connect Calibre-Web or Kavita under Servers.",
  },
  audiobooks: {
    type: 'book', title: 'Audiobooks', format: 'Audiobook', fits: (m) => m.formats.some(isAudio),
    empty: 'No audiobooks yet. Add one and say what it\'s on (Audiobook, Audible, CD, or anything with "audio" in it), bring in a list, or connect Audiobookshelf under Servers. Books on CD or tape belong here too: say "Book on CD" or "Book on tape" and where they are kept.',
  },
};

/**
 * Everything you own to watch, hear, read or play, by title, with the formats you have it on. Given a
 * `library` (books, ebooks, audiobooks), the same collection shows only what belongs in it.
 */
export default function MediaPage({ library = null }) {
  const lib = library ? LIBRARIES[library] : null;
  const [titles, setTitles] = useState(null);
  const [type, setType] = useState(lib?.type ?? '');
  const [show, setShow] = useState('');     // '', 'wanted' or 'lent'
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(null);       // null, or what the new title starts with
  const [scanning, setScanning] = useState(false);
  const [listing, setListing] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(() => { axios.get('/api/media').then(({ data }) => setTitles(data)).catch(() => setTitles([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!titles) return null;
  const mine = lib ? titles.filter((m) => m.type === lib.type && lib.fits(m)) : titles;
  const word = q.trim().toLowerCase();
  const shown = mine.filter((m) => (!type || m.type === type) && (show !== 'wanted' || m.wanted) && (show !== 'lent' || m.lent_to.length > 0)
    && (!word || [m.title, m.creator, ...m.genres, ...m.formats].some((v) => String(v ?? '').toLowerCase().includes(word))));
  const count = (id) => titles.filter((m) => m.type === id).length;
  const chip = (active) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-life-600 text-white' : 'bg-white text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">{lib ? lib.title : 'Collection'}</h1>
        {lib && <button type="button" onClick={() => setListing(true)} className={quietButtonClass}>Bring in a list</button>}
        <button type="button" onClick={() => setScanning(true)} className={quietButtonClass}>📷 Scan a barcode</button>
        <button type="button" onClick={() => setAdding({ type: type || 'film', format: lib?.format || '' })} className={buttonClass}>+ Add</button>
      </div>
      {mine.length === 0 && lib ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>{lib.empty}</div>
      ) : mine.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          Nothing here yet. Add a film, an album or a book, and say what you have it on: VHS, Blu-ray, vinyl, paperback, anything.
          The same title on two formats is one title with two copies.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to show">
            {!lib && <button type="button" onClick={() => setType('')} aria-pressed={!type} className={chip(!type)}>Everything <span className="opacity-70">{titles.length}</span></button>}
            {TYPES.filter(([id]) => !lib && count(id) > 0).map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => setType(id)} aria-pressed={type === id} className={chip(type === id)}>{icon} {label} <span className="opacity-70">{count(id)}</span></button>
            ))}
            {mine.some((m) => m.wanted) && <button type="button" onClick={() => setShow(show === 'wanted' ? '' : 'wanted')} aria-pressed={show === 'wanted'} className={chip(show === 'wanted')}>Wanted</button>}
            {mine.some((m) => m.lent_to.length) && <button type="button" onClick={() => setShow(show === 'lent' ? '' : 'lent')} aria-pressed={show === 'lent'} className={chip(show === 'lent')}>Lent out</button>}
          </div>
          {mine.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a title, a person, a genre or a format" aria-label="Find in the collection" className={`${inputClass} max-w-sm`} />}
          {shown.length === 0 ? <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</div> : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((m) => (
                <li key={m.id}>
                  <Link to={`/media/${m.id}`} className={`${cardClass} flex h-full gap-3 hover:ring-life-300`}>
                    {localCover(m.cover) ? <img src={m.cover} alt="" loading="lazy" className="h-20 w-14 flex-none rounded object-cover" />
                      : <span aria-hidden="true" className="flex h-20 w-14 flex-none items-center justify-center rounded bg-life-50 text-2xl dark:bg-life-700">{typeOf(m.type)[2]}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-life-800 dark:text-life-50">{m.title}{m.year ? <span className="font-normal text-gray-500 dark:text-life-300"> ({m.year})</span> : null}</span>
                      {m.creator && <span className="block truncate text-xs text-gray-500 dark:text-life-300">{m.creator}</span>}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.formats.map((f) => <span key={f} className="rounded bg-life-50 px-1.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{f}</span>)}
                        {m.wanted && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">wanted</span>}
                        {m.lent_to.map((who) => <span key={who} className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">with {who}</span>)}
                      </span>
                      {m.times > 0 && <span className="mt-1 block text-xs text-gray-500 dark:text-life-300">{DID[m.type].toLowerCase()} {m.times === 1 ? 'once' : `${m.times} times`}, last on {m.last_on}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {adding && (
        <Modal title="Add to the collection" onClose={() => setAdding(null)}>
          <TitleForm title={adding} withCopy onDone={(m) => navigate(`/media/${m.id}`)} />
        </Modal>
      )}
      {listing && (
        <Modal title="Bring in a list of books" onClose={() => { setListing(false); load(); }}>
          <BookList format={lib?.format || ''} onDone={() => { setListing(false); load(); }} />
        </Modal>
      )}
      {scanning && (
        <Modal title="Scan a barcode" onClose={() => setScanning(false)}>
          <ScanToFind onAdd={(start) => { setScanning(false); setAdding({ ...start, type: start.type || type || 'film', format: start.format || lib?.format || '' }); }} />
        </Modal>
      )}
    </div>
  );
}

/**
 * What a barcode is, from outside, when looking that kind of thing up is turned on: a book by its ISBN, a
 * film, album or game by its product number. When it's off, what turning it on would send, to offer that.
 */
async function lookUp(code) {
  const isbn = /^(97[89]\d{10}|\d{9}[\dXx])$/.test(code.replace(/[\s-]/g, ''));
  const { data: can } = await axios.get('/api/lookups').catch(() => ({ data: {} }));
  const which = isbn ? 'books' : 'titles';
  if (!can[which]) {
    if (!can.available) return {};
    const service = isbn ? can.service : can.title_services;
    return { offer: { which, name: service.name, sends: service.sends } };
  }
  try {
    if (isbn) {
      const { data: { book } } = await axios.get('/api/lookups/book', { params: { code } });
      if (!book) return { hint: "Open Library doesn't know this book. Add it and type the title in." };
      return {
        from: 'Open Library', start: { type: 'book', title: book.title, creator: book.creator || '', genres: book.genres || [], barcode: code },
        detail: [book.creator, book.edition_year && `this printing ${book.edition_year}`, book.pages && `${book.pages} pages`],
      };
    }
    const { data: { title } } = await axios.get('/api/lookups/title', { params: { code } });
    if (!title) return { hint: "Neither MusicBrainz nor UPCitemdb knows this barcode. Add it and type the title in." };
    return {
      from: title.from, start: { type: title.type, title: title.title, creator: title.creator || '', year: title.year ?? '', format: title.format || '', barcode: code },
      detail: [title.creator, title.year, title.format],
    };
  } catch (err) { return { hint: errorMessage(err, "It couldn't be looked up just now.") }; }
}

/**
 * Scan, then: straight to the title if you have it, or the offer to add it with the barcode kept and its
 * details filled in from what was looked up.
 */
function ScanToFind({ onAdd }) {
  const [round, setRound] = useState(0);
  const [found, setFound] = useState(null);         // null while scanning, else what was found, or { code, error }
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const look = useCallback(async (code) => {
    // A place's sticker, scanned from here, goes to its place all the same.
    if (stickerCode(code)) { navigate(`/p/${stickerCode(code)}`); return; }
    try {
      const { data } = await axios.get('/api/media/barcode', { params: { code } });
      if (data.length === 1) { navigate(`/media/${data[0].id}`); return; }
      setFound({ code, matches: data, ...(data.length === 0 ? await lookUp(code) : {}) });
    } catch (err) { setFound({ code, error: errorMessage(err, "Couldn't look that up") }); }
  }, [navigate]);
  const turnOn = async () => {
    setBusy(true);
    try {
      await axios.put('/api/lookups', { [found.offer.which]: true });
      setFound({ code: found.code, matches: found.matches, ...await lookUp(found.code) });
    } catch (err) { setFound({ ...found, offer: null, hint: errorMessage(err, "Couldn't turn that on") }); }
    setBusy(false);
  };
  if (!found) return <Scanner key={round} onCode={look} />;
  const again = <button type="button" onClick={() => { setFound(null); setRound(round + 1); }} className={quietButtonClass}>Scan another</button>;
  if (found.error) return <div className="space-y-3"><p className="text-sm text-red-600">{found.error}</p>{again}</div>;
  if (found.matches.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-800 dark:text-life-50">Nothing in your collection has the barcode <span className="font-mono">{found.code}</span>.</p>
        {found.start && (
          <div className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-800 dark:bg-life-700 dark:text-life-50" data-found>
            <p className="text-xs text-gray-500 dark:text-life-300">{found.from} says it's</p>
            <p className="font-medium">{typeOf(found.start.type)[2]} {found.start.title}</p>
            <p className="text-xs text-gray-600 dark:text-life-200">{found.detail.filter(Boolean).join(' · ')}</p>
          </div>
        )}
        {found.offer && (
          <div className="space-y-2 rounded-lg border border-life-200 p-3 text-sm text-gray-700 dark:border-life-700 dark:text-life-100">
            <p>Life Is can fill in what this is for you, by asking {found.offer.name}. <span className="font-medium">What it's sent:</span> {found.offer.sends}</p>
            <button type="button" onClick={turnOn} disabled={busy} className={quietButtonClass}>{busy ? 'Looking…' : 'Turn that on and look it up'}</button>
            <p className="text-xs text-gray-500 dark:text-life-300">It stays on for next time. Turn it off in Settings, under Outside services.</p>
          </div>
        )}
        {found.hint && <p className="text-xs text-gray-500 dark:text-life-300">{found.hint}</p>}
        <div className="flex items-center justify-end gap-2">{again}
          <button type="button" onClick={() => onAdd(found.start ?? { barcode: found.code })} className={buttonClass}>{found.start ? 'Add it' : 'Add it, keeping the barcode'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800 dark:text-life-50">More than one copy has the barcode <span className="font-mono">{found.code}</span>:</p>
      <ul className="space-y-1">
        {found.matches.map((m, i) => <li key={`${m.id}-${i}`}><Link to={`/media/${m.id}`} className="text-sm text-life-700 hover:underline dark:text-life-100">{typeOf(m.type)[2]} {m.title}{m.year ? ` (${m.year})` : ''} · {m.format}</Link></li>)}
      </ul>
      {again}
    </div>
  );
}

/** A title's own details. With `withCopy`, also the first copy: what it's on and where it is. */
function TitleForm({ title, withCopy = false, onDone }) {
  const [form, setForm] = useState({
    type: title.type || 'film', title: title.title || '', creator: title.creator || '', year: title.year ?? '', genres: (title.genres || []).join(', '),
    minutes: title.minutes ?? '', cover: title.cover || '', summary: title.summary || '', note: title.note || '', wanted: !!title.wanted, format: title.format || '', place_id: '',
    barcode: title.barcode || '',
  });
  const [formats, setFormats] = useState([]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  useEffect(() => { axios.get('/api/media/formats', { params: { type: form.type } }).then(({ data }) => setFormats(data)).catch(() => {}); }, [form.type]);
  useEffect(() => { if (withCopy) axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {}); }, [withCopy]);
  const submit = async (e) => {
    e.preventDefault();
    const body = { type: form.type, title: form.title, creator: form.creator || null, year: form.year === '' ? null : Number(form.year), genres: commaList(form.genres),
      minutes: form.minutes === '' ? null : Number(form.minutes), cover: form.cover || null, summary: form.summary || null, note: form.note || null, wanted: form.wanted };
    if (withCopy && !form.wanted && form.format) body.copy = { format: form.format, place_id: form.place_id === '' ? null : Number(form.place_id), barcode: form.barcode || null };
    try { onDone((title.id ? await axios.put(`/api/media/${title.id}`, body) : await axios.post('/api/media', body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="What it is">
          <select value={form.type} onChange={set('type')} className={inputClass}>{TYPES.map(([id, , icon, one]) => <option key={id} value={id}>{icon} {one}</option>)}</select>
        </Field>
        <div className="col-span-2"><Field label="Title *"><input required autoFocus={!title.id} value={form.title} onChange={set('title')} className={inputClass} /></Field></div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Field label={CREATOR[form.type]}><input value={form.creator} onChange={set('creator')} className={inputClass} /></Field></div>
        <Field label="Year"><input type="number" min="0" max="9999" step="1" value={form.year} onChange={set('year')} className={inputClass} /></Field>
      </div>
      {withCopy && (
        <div className="space-y-3 rounded-lg bg-life-50 p-3 dark:bg-life-700">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <input type="checkbox" checked={form.wanted} onChange={(e) => setForm({ ...form, wanted: e.target.checked })} className="accent-life-600" /> I don't have it yet: I want it
          </label>
          {!form.wanted && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={form.barcode ? "What it's on *" : "What it's on"}><input list="media-formats" required={Boolean(form.barcode)} value={form.format} onChange={set('format')} placeholder={formats.slice(0, 3).join(', ') || 'Any word you like'} className={inputClass} /></Field>
              <Field label="Where it is">
                <PlacePicker value={form.place_id} places={places} onPlaces={setPlaces} onChange={(id) => setForm((f) => ({ ...f, place_id: id }))} />
              </Field>
              {form.barcode && <p className="col-span-2 text-xs text-gray-600 dark:text-life-200">Barcode <span className="font-mono">{form.barcode}</span> will be kept with this copy, so scanning it finds it next time.</p>}
            </div>
          )}
        </div>
      )}
      <datalist id="media-formats">{formats.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2"><Field label="Genres, with commas between"><input value={form.genres} onChange={set('genres')} placeholder="Horror, Science fiction" className={inputClass} /></Field></div>
        <Field label="Runs for (minutes)"><input type="number" min="0" step="1" value={form.minutes} onChange={set('minutes')} className={inputClass} /></Field>
      </div>
      {title.id && (
        <>
          <Field label="What it's about"><textarea rows={3} value={form.summary} onChange={set('summary')} className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <input type="checkbox" checked={form.wanted} onChange={(e) => setForm({ ...form, wanted: e.target.checked })} className="accent-life-600" /> I want (another copy of) it
          </label>
        </>
      )}
      <Field label="Your notes"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** One title: its copies and where they are, and each time it was watched, read, heard or played. */
export function MediaTitlePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState(undefined);
  const [modal, setModal] = useState(null);
  const load = useCallback(() => { axios.get(`/api/media/${id}`).then(({ data }) => setTitle(data)).catch(() => setTitle(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (title === undefined) return null;
  if (title === null) return <p className="text-sm text-gray-600 dark:text-life-200">That isn't in your collection. <Link to="/media" className="underline">The whole collection</Link></p>;
  const saved = (data) => { setTitle(data); setModal(null); };
  const did = DID[title.type];
  const today = async () => { saved((await axios.post(`/api/media/${id}/log`, { day: toDateInput(new Date()) })).data); };
  const removeLog = async (entry) => { await axios.delete(`/api/media/log/${entry.id}`).catch(() => {}); load(); };
  const remove = async () => {
    if (!window.confirm(`Remove ${title.title} from your collection, with its copies and its log?`)) return;
    await axios.delete(`/api/media/${id}`).catch(() => {});
    navigate('/media');
  };
  return (
    <div className="space-y-4">
      <div>
        <Link to="/media" className="text-xs text-life-600 hover:underline dark:text-life-200">← Collection</Link>
        <div className="flex flex-wrap items-start gap-3">
          {localCover(title.cover) && <img src={title.cover} alt="" className="h-36 w-24 flex-none rounded object-cover" />}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{title.title}</h1>
            <p className="text-sm text-gray-500 dark:text-life-300">
              {[`${typeOf(title.type)[2]} ${typeOf(title.type)[3]}`, title.creator, title.year, title.minutes != null && minutesText(title.minutes), title.genres.join(', ')].filter(Boolean).join(' · ')}
            </p>
            {title.wanted && <p className="mt-1"><span className="rounded bg-honey-100 px-1.5 text-xs text-honey-700">wanted</span></p>}
            {title.summary && <p className="mt-2 text-sm text-gray-700 dark:text-life-100">{title.summary}</p>}
            {title.note && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700 dark:text-life-100">{title.note}</p>}
          </div>
          <button type="button" onClick={() => setModal({ edit: true })} className={quietButtonClass}>Edit</button>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className={cardClass}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">Your copies</h2>
            <button type="button" onClick={() => setModal({ copy: {} })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Add</button>
          </div>
          {title.copies.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-200">No copies. Add one for each you own: the VHS, the Blu-ray, the file on your media server.</p> : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {title.copies.map((copy) => (
                <li key={copy.id} className="flex items-start gap-2">
                  <button type="button" onClick={() => setModal({ copy })} className="flex min-w-0 flex-1 items-start gap-2 py-2 text-left">
                    <span className="flex-1">
                      <span className="block text-sm text-gray-800 dark:text-life-50">{copy.format}</span>
                      <span className="block text-xs text-gray-500 dark:text-life-300">
                        {[copy.place && `📍 ${copy.place}`, copy.source && `from ${sourceName(copy.source)}`, copy.barcode && `barcode ${copy.barcode}`, copy.note].filter(Boolean).join(' · ') || 'no place'}
                      </span>
                    </span>
                    {copy.lent_to && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">with {copy.lent_to} since {copy.lent_on}</span>}
                  </button>
                  {copy.link && <a href={copy.link} target="_blank" rel="noopener noreferrer" className="py-2 text-xs font-medium text-life-600 hover:underline dark:text-life-200">Open in {opensIn(copy.link, copy.source)}</a>}
                  <button type="button" onClick={() => setModal({ history: copy })} className="py-2 text-xs text-life-600 hover:underline dark:text-life-200">History</button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={cardClass}>
          <div className="mb-1 flex items-center gap-2">
            <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{did}</h2>
            <button type="button" onClick={today} className="text-sm text-life-600 hover:underline dark:text-life-200">{did} today</button>
            <button type="button" onClick={() => setModal({ log: true })} className="text-sm text-life-600 hover:underline dark:text-life-200">+ Another day</button>
          </div>
          {title.log.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-200">Not yet. It also fills in when you add it to the time on a project.</p> : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {title.log.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 py-2">
                  <span className="flex-1">
                    <span className="block text-sm text-gray-800 dark:text-life-50">{entry.day}</span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">
                      {entry.project && <>while working on <Link to={`/projects/${entry.project_id}`} className="underline">{entry.project}</Link></>}
                      {entry.project && entry.note ? ' · ' : ''}{entry.note}
                    </span>
                  </span>
                  <button type="button" onClick={() => removeLog(entry)} className="text-xs text-gray-400 hover:text-red-600" aria-label={`Remove ${entry.day}`}>✕</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <p className="text-right"><button type="button" onClick={remove} className="text-xs text-red-600 hover:underline">Remove from the collection</button></p>
      {modal?.edit && <Modal title={title.title} onClose={() => setModal(null)}><TitleForm title={title} onDone={saved} /></Modal>}
      {modal?.history && <Modal title={`Where the ${modal.history.format.toLowerCase()} has been`} onClose={() => setModal(null)}><CopyHistory copy={modal.history} /></Modal>}
      {modal?.copy && <Modal title={modal.copy.id ? modal.copy.format : 'A copy'} onClose={() => setModal(null)}><CopyForm title={title} copy={modal.copy} onDone={saved} /></Modal>}
      {modal?.log && <Modal title={did} onClose={() => setModal(null)}><LogForm mediaId={title.id} onDone={saved} /></Modal>}
    </div>
  );
}

/** Where one copy has been, as a thing's history shows it. */
function CopyHistory({ copy }) {
  const [history, setHistory] = useState(null);
  useEffect(() => { axios.get(`/api/media/copies/${copy.id}/history`).then(({ data }) => setHistory(data)).catch(() => setHistory([])); }, [copy.id]);
  return history ? <HistoryList history={history} /> : null;
}

function CopyForm({ title, copy, onDone }) {
  const [scanning, setScanning] = useState(false);
  const [form, setForm] = useState({ format: copy.format || '', place_id: copy.place_id ?? '', barcode: copy.barcode || '', lent_to: copy.lent_to || '', lent_on: copy.lent_on || '', note: copy.note || '', link: copy.link || '' });
  const [formats, setFormats] = useState([]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  useEffect(() => {
    axios.get('/api/media/formats', { params: { type: title.type } }).then(({ data }) => setFormats(data)).catch(() => {});
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
  }, [title.type]);
  const submit = async (e) => {
    e.preventDefault();
    const body = { format: form.format, place_id: form.place_id === '' ? null : Number(form.place_id), barcode: form.barcode || null, lent_to: form.lent_to || null, lent_on: form.lent_on || null, note: form.note || null, link: form.link.trim() || null };
    try { onDone((copy.id ? await axios.put(`/api/media/copies/${copy.id}`, body) : await axios.post(`/api/media/${title.id}/copies`, body)).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  const remove = async () => { try { onDone((await axios.delete(`/api/media/copies/${copy.id}`)).data); } catch (err) { setError(errorMessage(err, "Couldn't remove it")); } };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="What it's on *"><input required autoFocus={!copy.id} list="copy-formats" value={form.format} onChange={set('format')} placeholder={formats.slice(0, 3).join(', ') || 'Any word you like'} className={inputClass} /></Field>
        <Field label="Where it is">
          <PlacePicker value={form.place_id} places={places} onPlaces={setPlaces} onChange={(id) => setForm((f) => ({ ...f, place_id: id }))} />
        </Field>
      </div>
      <datalist id="copy-formats">{formats.map((f) => <option key={f} value={f} />)}</datalist>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lent to (empty: it's at home)"><input value={form.lent_to} onChange={set('lent_to')} className={inputClass} /></Field>
        <Field label="Lent on"><input type="date" value={form.lent_on} onChange={set('lent_on')} className={inputClass} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Barcode">
          <span className="flex gap-2">
            <input inputMode="numeric" value={form.barcode} onChange={set('barcode')} className={inputClass} />
            <button type="button" onClick={() => setScanning(!scanning)} aria-label="Scan the barcode with the camera" className={quietButtonClass}>📷</button>
          </span>
        </Field>
        {scanning && <div className="col-span-2"><Scanner onCode={(code) => { setForm((f) => ({ ...f, barcode: code })); setScanning(false); }} /></div>}
        <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="the steelbook, ex-rental…" className={inputClass} /></Field>
      </div>
      <Field label="A link that opens it (for one kept in an app or on a server)">
        <input type="text" inputMode="url" value={form.link} onChange={set('link')} placeholder="https://read.amazon.com/…" className={inputClass} />
      </Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        Open the book in Kindle, Apple Books or Google Play Books, use Share or copy its address, and paste it here. Life Is only keeps it: it's followed when you press it.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between">
        {copy.id ? <button type="button" onClick={remove} className="text-sm text-red-600 hover:underline">Remove this copy</button> : <span />}
        <button type="submit" className={buttonClass}>Save</button>
      </div>
    </form>
  );
}

function LogForm({ mediaId, onDone }) {
  const [form, setForm] = useState({ day: toDateInput(new Date()), note: '' });
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try { onDone((await axios.post(`/api/media/${mediaId}/log`, { day: form.day, note: form.note || null })).data); } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Day *"><input required type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} className={inputClass} /></Field>
      <Field label="A note"><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="with the lights off" className={inputClass} /></Field>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Add</button></div>
    </form>
  );
}
