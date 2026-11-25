import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Icon, { Dots } from '../components/Icon';
import axios from 'axios';
import Scanner from '../components/Scanner';
import PlacePicker from '../components/PlacePicker';
import BookList from '../components/BookList';
import StarRating from '../components/StarRating';
import BulkScan from '../components/BulkScan';
import CollectionSummary from '../components/CollectionSummary';
import Art from '../components/Art';
import { BulkBar, PickBox, SelectButton, TagChips, TagFilter, TagPicker, saveTags, useSelecting } from '../components/tags';
import { SORTS, centsFromDollars, decadeOf, dollarsField, dollarsText, labelKey, sameTitles, sortTitles } from '../components/collectionTools';
import { bookServerName } from '../components/BookServers';
import { formatChips, formatGroupName, inFormatGroup } from '../components/formatGroups';
import { onDevice } from '../where';
import { HistoryList } from './Thing';
import { stickerCode } from './Places';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput, minutesText } from '../components/ui';

export const TYPES = [['film', 'Films', 'film', 'Film'], ['show', 'Shows', 'show', 'Show'], ['music', 'Music', 'music', 'Music'], ['book', 'Books', 'book', 'Book'], ['game', 'Games', 'game', 'Game'], ['other', 'Other', 'other', 'Something else']];
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
/**
 * The word for the pieces a copy comes in, by its format. The same function is in core/src/media.ts (pages cannot
 * import from there), and is tested there: keep them alike. `known` is false for the plain word "piece", which
 * the copy form only offers when asked.
 */
export function piecesWord(format) {
  const f = (format || '').toLowerCase();
  if (/\b(cds?|dvds?|blu.?ray|4k|uhd|laser.?disc|discs?|disks?)\b/.test(f)) return { one: 'disc', many: 'discs', known: true };
  if (/tape|cassette|\bvhs\b|beta.?max|8.?track/.test(f)) return { one: 'tape', many: 'tapes', known: true };
  if (/vinyl|\blps?\b|\brecords?\b/.test(f)) return { one: 'record', many: 'records', known: true };
  return { one: 'piece', many: 'pieces', known: false };
}
/** "12 discs", or nothing when there is no number or just the one piece. */
const piecesText = (format, pieces) => (pieces >= 2 ? `${pieces} ${piecesWord(format).many}` : null);
/**
 * The old links to the book shelves (/media/books, /media/ebooks, /media/audiobooks) open the Collection with Books
 * and the matching format chip chosen. `empty` is the hint shown with that chip while nothing is in it.
 */
export const LIBRARIES = {
  books: {
    type: 'book', group: 'print', title: 'Books',
    empty: "No print books yet. Scan the barcode on the back (its ISBN) and Life Is looks up the title and author, then asks where it's kept: a room, and a shelf in it.",
  },
  ebooks: {
    type: 'book', group: 'ebook', title: 'eBooks', format: 'eBook',
    empty: "No eBooks yet. Add one and say what it's on (eBook, Kindle, Kobo, anything you like), import a list from Goodreads, or connect Calibre-Web or Kavita under Connections.",
  },
  audiobooks: {
    type: 'book', group: 'audio', title: 'Audiobooks', format: 'Audiobook',
    empty: "No audiobooks yet. Add one and say what it's on (Audiobook, Audible, CD, or anything with \"audio\" in it), import a list, or connect Audiobookshelf under Connections. Books on CD or tape belong here too: say \"Book on CD\" or \"Book on tape\" and where they are kept.",
  },
};
/** The hint for a chosen format chip with nothing in it yet. */
const emptyHint = (type, group) => Object.values(LIBRARIES).find((l) => l.type === type && l.group === group)?.empty
  ?? `Nothing on ${formatGroupName(type, group) || 'that format'} yet. Add a copy and say what it's on.`;

const SORT_KEY = 'lifeis.mediaSort';
const savedSort = () => { try { const s = localStorage.getItem(SORT_KEY); return SORTS.some(([id]) => id === s) ? s : 'title'; } catch { return 'title'; } };
const saveSort = (how) => { try { localStorage.setItem(SORT_KEY, how); } catch { /* remembered for this visit only */ } };
const control = 'min-h-[44px]';

/**
 * Everything you own to watch, hear, read or play, by title, with the formats you have it on. Choosing a kind
 * (Books, Films, Shows, Music) opens a second row of chips for the formats. Given a `library` (the old links for
 * books, ebooks and audiobooks), it opens with Books and the matching format chosen.
 */
export default function MediaPage({ library = null }) {
  const lib = library ? LIBRARIES[library] : null;
  const [titles, setTitles] = useState(null);
  const [type, setType] = useState(lib?.type ?? '');
  const [format, setFormat] = useState(lib?.group ?? '');   // a group from formatGroups.js, or '' for all of them
  const [show, setShow] = useState('');     // '' or 'lent' (what is wanted is on the Wanted list)
  const [q, setQ] = useState('');
  const [genre, setGenre] = useState('');
  const [from, setFrom] = useState('');     // the years asked for: from, and to
  const [to, setTo] = useState('');
  const [sort, setSort] = useState(savedSort);
  const [tag, setTag] = useState('');
  const sel = useSelecting();
  const [adding, setAdding] = useState(null);       // null, or what the new title starts with
  const [scanning, setScanning] = useState(false);
  const [scanMany, setScanMany] = useState(false);
  const [listing, setListing] = useState(false);
  const navigate = useNavigate();
  const load = useCallback(() => { axios.get('/api/media', { params: { tag: tag || undefined } }).then(({ data }) => setTitles(data)).catch(() => setTitles([])); }, [tag]);
  useEffect(() => { load(); }, [load]);
  if (!titles) return null;
  const mine = titles;
  const word = q.trim().toLowerCase();
  const lo = from === '' ? null : Number(from);
  const hi = to === '' ? null : Number(to);
  const matching = mine.filter((m) => (!type || m.type === type) && (!type || inFormatGroup(m, format)) && (show !== 'lent' || m.lent_to.length > 0)
    && (!genre || m.genres.some((g) => labelKey(g) === labelKey(genre)))
    && (lo === null || (m.year != null && m.year >= lo)) && (hi === null || (m.year != null && m.year <= hi))
    && (!word || [m.title, m.creator, ...m.genres, ...m.formats].some((v) => String(v ?? '').toLowerCase().includes(word))));
  const shown = sortTitles(matching, sort);
  const genres = [...new Map(mine.flatMap((m) => m.genres).map((g) => [labelKey(g), g])).values()].sort((a, b) => labelKey(a).localeCompare(labelKey(b)));
  const decades = [...new Set(mine.filter((m) => m.year != null).map((m) => decadeOf(m.year)))].sort((a, b) => b - a);
  const decade = from !== '' && to !== '' && Number(from) % 10 === 0 && Number(to) === Number(from) + 9 ? String(from) : '';
  const filtering = Boolean(type || show || word || genre || from !== '' || to !== '' || tag);
  const clearFilters = () => { setType(''); setFormat(''); setShow(''); setQ(''); setGenre(''); setFrom(''); setTo(''); setTag(''); };
  // The print page reads the tab, the filters and the sort back from the address.
  // A new title starts on the format the chosen chip names, when it names one (eBook, Audiobook).
  const addFormat = type === 'book' ? ({ ebook: 'eBook', audio: 'Audiobook' }[format] ?? '') : '';
  const printAddress = `/media/print?${new URLSearchParams(Object.entries({ type, format: type ? format : '', show, q: q.trim(), genre, from, to, sort }).filter(([, v]) => v !== '' && v != null))}`;
  const count = (id) => titles.filter((m) => m.type === id).length;
  const pickType = (id) => { setType(id); setFormat(''); };
  const chips = type ? formatChips(titles, type, format) : [];
  const chip = (active) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Collection</h1>
        {mine.length > 0 && <Link to={printAddress} className={`${quietButtonClass} ${control} inline-flex items-center`}>Print or save a list</Link>}
        <button type="button" onClick={() => setListing(true)} className={`${quietButtonClass} ${control}`}>Import a list</button>
        <button type="button" onClick={() => setScanning(true)} className={`${quietButtonClass} ${control}`}><Icon of="scan" /> Scan a barcode</button>
        <button type="button" onClick={() => setScanMany(true)} className={`${quietButtonClass} ${control}`}><Icon of="scan" /> Scan many</button>
        <button type="button" onClick={() => setAdding({ type: type || 'film', format: addFormat })} className={`${buttonClass} ${control}`}>+ Add</button>
      </div>
      {mine.length === 0 && tag ? (
        <>
          <div className="flex flex-wrap items-center gap-2"><TagFilter value={tag} onChange={setTag} /></div>
          <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing with that tag.</div>
        </>
      ) : mine.length === 0 && lib ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}><Art slot="empty" className="mx-auto mb-2 block h-12 w-12" />{lib.empty}</div>
      ) : mine.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>
          <Art slot="empty" className="mx-auto mb-2 block h-12 w-12" />
          Nothing here yet. Add a film, an album or a book, and say what you have it on: VHS, Blu-ray, vinyl, paperback, anything.
          The same title on two formats is one title with two copies.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="What to show">
            <button type="button" onClick={() => pickType('')} aria-pressed={!type} className={chip(!type)}>Everything <span className="opacity-80">{titles.length}</span></button>
            {TYPES.filter(([id]) => count(id) > 0).map(([id, label, icon]) => (
              <button key={id} type="button" onClick={() => pickType(id)} aria-pressed={type === id} className={chip(type === id)}><Icon of={icon} /> {label} <span className="opacity-80">{count(id)}</span></button>
            ))}
            <Link to="/media/lists" className={`${chip(false)} inline-flex min-h-[44px] items-center`} data-wanted-list>Wanted list</Link>
            {mine.some((m) => m.lent_to.length) && <button type="button" onClick={() => setShow(show === 'lent' ? '' : 'lent')} aria-pressed={show === 'lent'} className={chip(show === 'lent')}>Lent out</button>}
          </div>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${typeOf(type)[1]}, by format`} data-formats>
              {chips.map((c) => <button key={c.id} type="button" onClick={() => setFormat(c.id)} aria-pressed={format === c.id} className={`${chip(format === c.id)} inline-flex min-h-[44px] items-center gap-1`}>{c.label} <span className="opacity-80">{c.count}</span></button>)}
            </div>
          )}
          {type && format && !chips.some((c) => c.id === format && c.count > 0) && (
            <p className="text-sm text-gray-600 dark:text-life-200" data-format-hint>{emptyHint(type, format)}</p>
          )}
          {mine.length > 6 && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a title, a person, a genre or a format" aria-label="Find in the collection" className={`${inputClass} ${control} max-w-sm`} />}
          <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap" role="group" aria-label="Sort and narrow down">
            {mine.length > 1 && (
              <div className="col-span-2 space-y-1 sm:col-span-1">
                <span id="sort-by" className="block text-xs font-medium text-gray-600 dark:text-life-200">Sort by</span>
                <select aria-labelledby="sort-by" value={sort} onChange={(e) => { setSort(e.target.value); saveSort(e.target.value); }} className={`${inputClass} ${control}`}>
                  {SORTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </div>
            )}
            {genres.length > 0 && (
              <div className="space-y-1">
                <span id="genre-is" className="block text-xs font-medium text-gray-600 dark:text-life-200">Genre</span>
                <select aria-labelledby="genre-is" value={genre} onChange={(e) => setGenre(e.target.value)} className={`${inputClass} ${control}`}>
                  <option value="">Any genre</option>
                  {genres.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
            <div className="self-end"><TagFilter value={tag} onChange={setTag} className={control} /></div>
            {decades.length > 0 && (
              <div className="space-y-1">
                <span id="decade-is" className="block text-xs font-medium text-gray-600 dark:text-life-200">Decade</span>
                <select aria-labelledby="decade-is" value={decade} onChange={(e) => { const d = e.target.value; setFrom(d); setTo(d === '' ? '' : String(Number(d) + 9)); }} className={`${inputClass} ${control}`}>
                  <option value="">Any decade</option>
                  {decades.map((d) => <option key={d} value={d}>{d}s</option>)}
                </select>
              </div>
            )}
            {decades.length > 0 && (
              <fieldset className="col-span-2 sm:col-span-1">
                <legend className="mb-1 text-xs font-medium text-gray-600 dark:text-life-200">Years, from and to</legend>
                <span className="flex items-center gap-2">
                  <input type="number" inputMode="numeric" min="0" max="9999" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From" aria-label="Year from" className={`${inputClass} ${control} sm:w-24`} />
                  <span aria-hidden="true" className="text-gray-500 dark:text-life-300">to</span>
                  <input type="number" inputMode="numeric" min="0" max="9999" value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" aria-label="Year to" className={`${inputClass} ${control} sm:w-24`} />
                </span>
              </fieldset>
            )}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-gray-500 dark:text-life-300" role="status">
            <span>Showing {shown.length} of {mine.length}</span>
            {filtering && <button type="button" onClick={clearFilters} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">Clear filters</button>}
            <SelectButton sel={sel} />
          </p>
          <BulkBar sel={sel} kind="title" list={shown.map((m) => m.id)} noun="titles" onDone={load} />
          <CollectionSummary titles={shown} />
          {shown.length === 0 ? <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing matches.</div> : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((m) => (
                <li key={m.id}>
                  <div className={`${cardClass} flex h-full flex-col gap-2 hover:ring-life-300`}>
                  <div className="flex gap-2">
                  <PickBox sel={sel} id={m.id} name={m.title} />
                  <Link to={`/media/${m.id}`} className="flex min-w-0 flex-1 gap-3">
                    {localCover(m.cover) ? <img src={m.cover} alt="" loading="lazy" className="h-20 w-14 flex-none rounded object-cover" />
                      : <span aria-hidden="true" className="flex h-20 w-14 flex-none items-center justify-center rounded bg-life-50 text-2xl dark:bg-life-700"><Icon of={typeOf(m.type)[2]} size={28} /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-life-800 dark:text-life-50">{m.title}{m.year ? <span className="font-normal text-gray-500 dark:text-life-300"> ({m.year})</span> : null}</span>
                      {m.creator && <span className="block truncate text-xs text-gray-500 dark:text-life-300">{m.creator}</span>}
                      <span className="mt-1 flex flex-wrap gap-1">
                        {m.formats.map((f) => <span key={f} className="rounded bg-life-50 px-1.5 text-[11px] text-life-700 dark:bg-life-700 dark:text-life-100">{[f, piecesText(f, m.pieces?.[f])].filter(Boolean).join(' · ')}</span>)}
                        {m.wanted && <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">wanted</span>}
                        {m.lent_to.map((who) => <span key={who} className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">with {who}</span>)}
                      </span>
                      {m.times > 0 && <span className="mt-1 block text-xs text-gray-500 dark:text-life-300">{DID[m.type].toLowerCase()} {m.times === 1 ? 'once' : `${m.times} times`}, last on {m.last_on}</span>}
                      {m.cost_cents != null || m.worth_cents != null ? (
                        <span className="mt-1 block text-xs text-gray-500 dark:text-life-300">{[m.cost_cents != null && `cost ${dollarsText(m.cost_cents)}`, m.worth_cents != null && `worth ${dollarsText(m.worth_cents)}`].filter(Boolean).join(' · ')}</span>
                      ) : null}
                    </span>
                  </Link>
                  </div>
                  <TagChips tags={m.tag_list} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {adding && (
        <Modal title="Add to the collection" onClose={() => setAdding(null)}>
          <TitleForm title={adding} withCopy known={titles} onDone={(m) => navigate(`/media/${m.id}`)} />
        </Modal>
      )}
      {listing && (
        <Modal title={type === 'book' ? 'Import a list of books' : 'Import a list'} onClose={() => { setListing(false); load(); }}>
          <BookList format={addFormat} mixed={type !== 'book'} type={type || 'film'} onDone={() => { setListing(false); load(); }} />
        </Modal>
      )}
      {scanMany && (
        <Modal title="Scan many" onClose={() => { setScanMany(false); load(); }}>
          <BulkScan lookUp={lookUp} ignoreCode={stickerCode} defaultType={type || 'film'} onDone={() => { setScanMany(false); load(); }} />
        </Modal>
      )}
      {scanning && (
        <Modal title="Scan a barcode" onClose={() => setScanning(false)}>
          <ScanToFind onAdd={(start) => { setScanning(false); setAdding({ ...start, type: start.type || type || 'film', format: start.format || addFormat }); }} />
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
    const format = title.format || '';
    return {
      from: title.from, start: { type: title.type, title: title.title, creator: title.creator || '', year: title.year ?? '', format, barcode: code },
      detail: [title.creator, title.year, format],
      // A film found by its name can be looked up further on TMDB, when that is on.
      tmdb: title.type === 'film' && Boolean(can.films),
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
            <p className="font-medium"><Icon of={typeOf(found.start.type)[2]} /> {found.start.title}</p>
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
        <div className="flex flex-wrap items-center justify-end gap-2">{again}
          {found.tmdb && !onDevice() && <button type="button" onClick={() => onAdd({ ...found.start, findOnTmdb: true })} className={quietButtonClass}>Find it on TMDB</button>}
          <button type="button" onClick={() => onAdd(found.start ?? { barcode: found.code })} className={buttonClass}>{found.start ? 'Add it' : 'Add it, keeping the barcode'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-800 dark:text-life-50">More than one copy has the barcode <span className="font-mono">{found.code}</span>:</p>
      <ul className="space-y-1">
        {found.matches.map((m, i) => <li key={`${m.id}-${i}`}><Link to={`/media/${m.id}`} className="text-sm text-life-700 hover:underline dark:text-life-100"><Icon of={typeOf(m.type)[2]} /> {m.title}{m.year ? ` (${m.year})` : ''} · {m.format}</Link></li>)}
      </ul>
      {again}
    </div>
  );
}

const FILLED = { title: 'title', year: 'year', minutes: 'length', genres: 'genres', summary: 'summary' };

/**
 * "Look it up" for a film or show, from TMDB, when the person has turned it on with their own key. Shows up to
 * eight matches with a small poster (fetched through Life Is: the page never asks another site for anything),
 * and choosing one fills the form's empty fields. What the person typed stays, unless they press "Use all of it".
 */
function FilmFinder({ form, setForm, hasCover, autoSearch, onPicked }) {
  const [can, setCan] = useState(null);
  const [matches, setMatches] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState(null);   // { match, filled, kept }
  const eligible = form.type === 'film' || form.type === 'show';
  useEffect(() => { if (eligible && !can) axios.get('/api/lookups').then(({ data }) => setCan(data)).catch(() => setCan({})); }, [eligible, can]);
  const look = async () => {
    setBusy(true); setMessage(''); setPicked(null);
    try {
      const { data } = await axios.get('/api/lookups/films/search', { params: { q: form.title, kind: form.type, ...(form.year !== '' ? { year: form.year } : {}) } });
      setMatches(data.matches);
      if (data.matches.length === 0) setMessage('TMDB has nothing by that name. Check the spelling, or leave the year out.');
    } catch (err) { setMatches(null); setMessage(errorMessage(err, "Couldn't look it up just now")); }
    setBusy(false);
  };
  // Scanned a film and chose "Find it on TMDB": the name that was found is searched for as soon as the form opens.
  useEffect(() => { if (autoSearch && can?.films && form.title) look(); }, [autoSearch, can?.films]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!eligible || !can?.available) return null;
  if (!can.films) {
    return <p className="text-xs text-gray-500 dark:text-life-300">Films and shows can be filled in from TMDB: turn that on, with your own key, in <Link to="/settings/connections" className="underline">Settings</Link>.</p>;
  }
  const choose = async (match, all) => {
    setBusy(true); setMessage('');
    try {
      const { data } = await axios.post('/api/lookups/films/pick', {
        kind: match.kind, id: match.id, all,
        current: { title: form.title, year: form.year, creator: form.creator, minutes: form.minutes, genres: commaList(form.genres), summary: form.summary },
      });
      if (!data.found) { setMessage("TMDB doesn't have that one any more."); setBusy(false); return; }
      const f = data.fields;
      setForm((cur) => ({ ...cur, title: f.title, year: f.year ?? '', creator: f.creator ?? '', minutes: f.minutes ?? '', genres: f.genres.join(', '), summary: f.summary ?? '' }));
      // A cover of your own is kept unless you take all of it.
      const poster = data.found.poster && (all || !hasCover) ? data.found.poster : null;
      onPicked({ kind: match.kind, id: match.id, poster });
      const name = (k) => (k === 'creator' ? (form.type === 'show' ? 'who made it' : 'director') : FILLED[k]);
      setPicked({ match, filled: [...data.filled.map(name), ...(poster ? ['poster'] : [])], kept: data.kept.map(name) });
    } catch (err) { setMessage(errorMessage(err, "Couldn't fetch its details just now")); }
    setBusy(false);
  };
  return (
    <div className="space-y-2 rounded-lg border border-life-200 p-3 text-sm dark:border-life-700" data-film-finder>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={look} disabled={busy || !form.title.trim()} className={quietButtonClass}>{busy ? 'Looking…' : 'Look it up'}</button>
        <span className="text-xs text-gray-500 dark:text-life-300">Sends the title{form.year !== '' ? ' and year' : ''} to TMDB with your key, and nothing else.</span>
      </div>
      {message && <p role="status" className="text-sm text-red-600">{message}</p>}
      {matches && matches.length > 0 && (
        <ul className="space-y-1" data-matches>
          {matches.map((m) => (
            <li key={`${m.kind}-${m.id}`} className="flex items-start gap-2">
              {m.poster ? <img src={`/api/lookups/films/poster?path=${encodeURIComponent(m.poster)}`} alt="" loading="lazy" className="h-14 w-10 flex-none rounded object-cover" /> : <span className="h-14 w-10 flex-none rounded bg-life-50 dark:bg-life-700" />}
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-800 dark:text-life-50">{m.title}{m.year ? ` (${m.year})` : ''}</span>
                {m.overview && <span className="block truncate text-xs text-gray-500 dark:text-life-300">{m.overview}</span>}
              </span>
              <button type="button" onClick={() => choose(m, false)} disabled={busy} className={quietButtonClass}>Use this</button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div role="status" className="space-y-1 text-xs text-gray-700 dark:text-life-100" data-picked>
          <p>From TMDB, {picked.match.title}{picked.match.year ? ` (${picked.match.year})` : ''}. {picked.filled.length ? `Filled in: ${picked.filled.join(', ')}.` : 'Nothing new to fill in.'}{picked.kept.length ? ` Kept what you typed: ${picked.kept.join(', ')}.` : ''}</p>
          {picked.kept.length > 0 && <button type="button" onClick={() => choose(picked.match, true)} disabled={busy} className={quietButtonClass}>Use all of it</button>}
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-life-300">{can.film_service?.notice}</p>
    </div>
  );
}

/** A title's own details. With `withCopy`, also the first copy: what it's on and where it is. */
function TitleForm({ title, withCopy = false, known = [], onDone }) {
  const [form, setForm] = useState({
    type: title.type || 'film', title: title.title || '', creator: title.creator || '', year: title.year ?? '', genres: (title.genres || []).join(', '),
    minutes: title.minutes ?? '', cover: title.cover || '', summary: title.summary || '', note: title.note || '', wanted: !!title.wanted, format: title.format || '', place_id: '',
    barcode: title.barcode || '',
  });
  const [tags, setTags] = useState(title.tag_list || []);
  const [formats, setFormats] = useState([]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState('');
  const [different, setDifferent] = useState('');   // the type and name the person said are a different one
  const [tmdb, setTmdb] = useState(null);           // the film or show chosen from TMDB: { kind, id, poster }
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  // A new title whose name is one you already have, of the same kind: asked about, never blocked.
  const askAbout = `${form.type}|${labelKey(form.title)}`;
  const dupes = withCopy && !title.id && different !== askAbout ? sameTitles(known, form.type, form.title) : [];
  const addCopyTo = async (existing) => {
    if (!form.format.trim()) { setError("Say what the new copy is on first (the box below)."); return; }
    setError('');
    try { onDone((await axios.post(`/api/media/${existing.id}/copies`, { format: form.format, place_id: form.place_id === '' ? null : Number(form.place_id), barcode: form.barcode || null })).data); } catch (err) { setError(errorMessage(err, "Couldn't add the copy")); }
  };
  useEffect(() => { axios.get('/api/media/formats', { params: { type: form.type } }).then(({ data }) => setFormats(data)).catch(() => {}); }, [form.type]);
  useEffect(() => { if (withCopy) axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {}); }, [withCopy]);
  const submit = async (e) => {
    e.preventDefault();
    const body = { type: form.type, title: form.title, creator: form.creator || null, year: form.year === '' ? null : Number(form.year), genres: commaList(form.genres),
      minutes: form.minutes === '' ? null : Number(form.minutes), cover: form.cover || null, summary: form.summary || null, note: form.note || null, wanted: form.wanted };
    if (withCopy && !form.wanted && form.format) body.copy = { format: form.format, place_id: form.place_id === '' ? null : Number(form.place_id), barcode: form.barcode || null };
    // What TMDB calls it is kept with the title, beside any other catalog's number.
    if (tmdb) body.ids = { ...(title.ids || {}), tmdb: tmdb.id, tmdb_kind: tmdb.kind };
    try {
      const saved = (title.id ? await axios.put(`/api/media/${title.id}`, body) : await axios.post('/api/media', body)).data;
      // The poster is fetched once, through Life Is, and kept as the cover. A poster that can't be fetched doesn't undo the save.
      if (tmdb?.poster) {
        try { saved.cover = (await axios.post('/api/lookups/films/cover', { media_id: saved.id, path: tmdb.poster })).data.cover; } catch { /* the title is saved all the same */ }
      }
      saved.tag_list = await saveTags('title', saved.id, tags);
      onDone(saved);
    } catch (err) { setError(errorMessage(err, "Couldn't save")); }
  };
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="What it is">
          <select value={form.type} onChange={set('type')} className={inputClass}>{TYPES.map(([id, , , one]) => <option key={id} value={id}>{one}</option>)}</select>
        </Field>
        <div className="col-span-2"><Field label="Title *"><input required autoFocus={!title.id} value={form.title} onChange={set('title')} className={inputClass} /></Field></div>
      </div>
      {dupes.length > 0 && (
        <div role="status" data-duplicate className="space-y-2 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
          {dupes.map((d) => (
            <div key={d.id} className="space-y-1">
              <p>You already have {d.title} ({d.formats.length ? d.formats.join(', ') : 'wanted, no copy yet'}){d.year ? `, from ${d.year}` : ''}.</p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/media/${d.id}`} className="inline-flex min-h-[44px] items-center rounded-lg border border-honey-700/40 px-3 text-honey-700 hover:bg-card/50">Open it</Link>
                {withCopy && !form.wanted && <button type="button" onClick={() => addCopyTo(d)} className="min-h-[44px] rounded-lg border border-honey-700/40 px-3 hover:bg-card/50">Add as a new copy of it</button>}
              </div>
            </div>
          ))}
          <button type="button" onClick={() => setDifferent(askAbout)} className="min-h-[44px] text-left underline">It's a different one</button>
        </div>
      )}
      {/* TMDB's terms restrict apps people pay for, so film lookups are offered only on a Life Is the person hosts
          themselves: in a browser, or in the phone app signed in to it. Never in the phone app keeping everything on the phone. */}
      {!onDevice() && <FilmFinder form={form} setForm={setForm} hasCover={Boolean(form.cover)} autoSearch={Boolean(title.findOnTmdb)} onPicked={setTmdb} />}
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
      {(title.id || form.summary) && <Field label="What it's about"><textarea rows={3} value={form.summary} onChange={set('summary')} className={inputClass} /></Field>}
      {title.id && (
        <>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-life-100">
            <input type="checkbox" checked={form.wanted} onChange={(e) => setForm({ ...form, wanted: e.target.checked })} className="accent-life-600" /> I want (another copy of) it
          </label>
        </>
      )}
      <Field label="Your notes"><textarea rows={2} value={form.note} onChange={set('note')} className={inputClass} /></Field>
      <TagPicker value={tags} onChange={setTags} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="text-right"><button type="submit" className={buttonClass}>Save</button></div>
    </form>
  );
}

/** What TMDB's terms ask to be shown beside details that came from it, in plain words. */
function TmdbNotice({ ids }) {
  const [notice, setNotice] = useState('');
  useEffect(() => { axios.get('/api/lookups').then(({ data }) => setNotice(data.film_service?.notice || '')).catch(() => {}); }, []);
  const kind = ids.tmdb_kind === 'tv' ? 'tv' : 'movie';
  return (
    <p className="mt-2 text-xs text-gray-500 dark:text-life-300" data-tmdb-notice>
      Details from <a href={`https://www.themoviedb.org/${kind}/${encodeURIComponent(ids.tmdb)}`} target="_blank" rel="noreferrer" className="underline">TMDB</a>. {notice}
    </p>
  );
}

/** One title: its copies and where they are, and each time it was watched, read, heard or played. */
export function MediaTitlePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState(undefined);
  const [modal, setModal] = useState(null);
  const [params] = useSearchParams();
  const load = useCallback(() => { axios.get(`/api/media/${id}`).then(({ data }) => setTitle(data)).catch(() => setTitle(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  // "I have it now" on a list comes here ready to add the copy.
  const wantsCopy = params.get('copy') === '1';
  const ready = title && title.copies.length === 0;
  useEffect(() => { if (wantsCopy && ready) setModal({ copy: {} }); }, [wantsCopy, ready]);
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
              <Dots parts={[<><Icon of={typeOf(title.type)[2]} /> {typeOf(title.type)[3]}</>, title.creator, title.year, title.minutes != null && minutesText(title.minutes), title.genres.join(', ')]} />
            </p>
            <StarRating id={title.id} stars={title.stars} onSaved={setTitle} />
            {title.ids?.letterboxd && /^https?:\/\//.test(title.ids.letterboxd) && <p className="mt-1 text-sm"><a href={title.ids.letterboxd} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center text-life-600 underline dark:text-life-200">On Letterboxd</a></p>}
            {title.wanted && <p className="mt-1"><span className="rounded bg-honey-100 px-1.5 text-xs text-honey-700">wanted</span></p>}
            {title.unowned && (
              <p className="mt-2 text-sm text-gray-700 dark:text-life-100" data-not-owned>
                You don't have this one yet, so it is not counted in your collection. It is on a list. <button type="button" onClick={() => setModal({ copy: {} })} className="min-h-[44px] font-medium text-life-600 underline dark:text-life-200">I have it now</button>
              </p>
            )}
            {title.summary && <p className="mt-2 text-sm text-gray-700 dark:text-life-100">{title.summary}</p>}
            {title.ids?.tmdb && title.ids?.tmdb_kind && <TmdbNotice ids={title.ids} />}
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
          {title.cost_cents != null || title.worth_cents != null ? (
            <p className="mb-1 text-xs text-gray-600 dark:text-life-200" data-money>
              Together: {[title.cost_cents != null && `cost ${dollarsText(title.cost_cents)}`, title.worth_cents != null && `worth ${dollarsText(title.worth_cents)}`].filter(Boolean).join(', ')}
            </p>
          ) : null}
          {title.copies.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-200">No copies. Add one for each you own: the VHS, the Blu-ray, the file on your media server.</p> : (
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {title.copies.map((copy) => (
                <li key={copy.id} className="flex items-start gap-2">
                  <button type="button" onClick={() => setModal({ copy })} className="flex min-w-0 flex-1 items-start gap-2 py-2 text-left">
                    <span className="flex-1">
                      <span className="block text-sm text-gray-800 dark:text-life-50">{[copy.format, piecesText(copy.format, copy.pieces)].filter(Boolean).join(' · ')}</span>
                      <span className="block text-xs text-gray-500 dark:text-life-300">
                        {(copy.place || copy.source || copy.barcode || copy.note) ? <Dots parts={[copy.place && <><Icon of="place" /> {copy.place}</>, copy.source && `from ${sourceName(copy.source)}`, copy.barcode && `barcode ${copy.barcode}`, copy.note]} /> : 'no place'}
                      </span>
                      <span className="block text-xs text-gray-500 dark:text-life-300">
                        {[copy.cost_cents != null && `cost ${dollarsText(copy.cost_cents)}${copy.bought_on ? ` on ${copy.bought_on}` : ''}`, copy.value_cents != null && `worth ${dollarsText(copy.value_cents)}${copy.valued_on ? ` on ${copy.valued_on}` : ''}`].filter(Boolean).join(' · ')}
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
                    <span className="block whitespace-pre-wrap text-xs text-gray-500 dark:text-life-300">
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
  const [form, setForm] = useState({ format: copy.format || '', place_id: copy.place_id ?? '', barcode: copy.barcode || '', lent_to: copy.lent_to || '', lent_on: copy.lent_on || '', note: copy.note || '', link: copy.link || '', pieces: copy.pieces ?? '', cost: dollarsField(copy.cost_cents), bought_on: copy.bought_on || '', value: dollarsField(copy.value_cents), valued_on: copy.valued_on || '' });
  const [askPieces, setAskPieces] = useState(false);
  const [formats, setFormats] = useState([]);
  const [places, setPlaces] = useState([]);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const word = piecesWord(form.format);
  const showPieces = word.known || form.pieces !== '' || askPieces;
  useEffect(() => {
    axios.get('/api/media/formats', { params: { type: title.type } }).then(({ data }) => setFormats(data)).catch(() => {});
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {});
  }, [title.type]);
  const submit = async (e) => {
    e.preventDefault();
    // Prices are typed as dollars and kept as cents. Empty is fine; something that isn't an amount is said so.
    const cost = form.cost.trim() === '' ? null : centsFromDollars(form.cost);
    const value = form.value.trim() === '' ? null : centsFromDollars(form.value);
    if ((form.cost.trim() !== '' && cost === null) || (form.value.trim() !== '' && value === null)) { setError('A price is dollars and cents, like 12.99'); return; }
    const today = toDateInput(new Date());
    // A worth that was changed is noted today, unless a day was typed for it.
    const valuedOn = value === null ? null : (form.value !== dollarsField(copy.value_cents) && form.valued_on === (copy.valued_on || '')) ? today : (form.valued_on || today);
    const body = { cost_cents: cost, bought_on: form.bought_on || null, value_cents: value, valued_on: valuedOn, format: form.format, place_id: form.place_id === '' ? null : Number(form.place_id), barcode: form.barcode || null, lent_to: form.lent_to || null, lent_on: form.lent_on || null, note: form.note || null, link: form.link.trim() || null, pieces: form.pieces === '' ? null : Number(form.pieces) };
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
      {showPieces ? (
        <Field label={`How many ${word.many}`}>
          <input type="number" inputMode="numeric" min="1" max="999" step="1" value={form.pieces} onChange={set('pieces')} placeholder="1" className={`${inputClass} min-h-[44px] max-w-[8rem]`} />
        </Field>
      ) : (
        <button type="button" onClick={() => setAskPieces(true)} className="min-h-[44px] text-left text-sm text-life-600 hover:underline dark:text-life-200">It comes in several pieces</button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Lent to (empty: it's at home)"><input value={form.lent_to} onChange={set('lent_to')} className={inputClass} /></Field>
        <Field label="Lent on"><input type="date" value={form.lent_on} onChange={set('lent_on')} className={inputClass} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Barcode">
          <span className="flex gap-2">
            <input inputMode="numeric" value={form.barcode} onChange={set('barcode')} className={inputClass} />
            <button type="button" onClick={() => setScanning(!scanning)} aria-label="Scan the barcode with the camera" className={quietButtonClass}><Icon of="scan" /></button>
          </span>
        </Field>
        {scanning && <div className="col-span-2"><Scanner onCode={(code) => { setForm((f) => ({ ...f, barcode: code })); setScanning(false); }} /></div>}
        <Field label="A note"><input value={form.note} onChange={set('note')} placeholder="the steelbook, ex-rental…" className={inputClass} /></Field>
      </div>
      <Field label="A link that opens it (for one kept in an app or on a server)">
        <input type="text" inputMode="url" value={form.link} onChange={set('link')} placeholder="https://read.amazon.com/…" className={inputClass} />
      </Field>
      <fieldset className="space-y-3 rounded-lg bg-life-50 p-3 dark:bg-life-700">
        <legend className="px-1 text-xs font-medium text-gray-600 dark:text-life-200">Cost and worth (all optional, and typed by you: nothing is looked up)</legend>
        <div className="grid grid-cols-2 gap-3">
          <Field label="What it cost ($)"><input inputMode="decimal" value={form.cost} onChange={set('cost')} placeholder="12.99" className={`${inputClass} min-h-[44px]`} /></Field>
          <Field label="Bought on"><input type="date" value={form.bought_on} onChange={set('bought_on')} className={`${inputClass} min-h-[44px]`} /></Field>
          <Field label="Worth now ($)"><input inputMode="decimal" value={form.value} onChange={set('value')} placeholder="20.00" className={`${inputClass} min-h-[44px]`} /></Field>
          {form.value.trim() !== '' && <Field label="Worth noted on"><input type="date" value={form.valued_on} onChange={set('valued_on')} className={`${inputClass} min-h-[44px]`} /></Field>}
        </div>
      </fieldset>
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
