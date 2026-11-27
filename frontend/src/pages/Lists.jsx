import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import Icon, { Dots } from '../components/Icon';
import LetterboxdIn from '../components/LetterboxdIn';
import { starsText } from '../components/collectionTools';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, toDateInput } from '../components/ui';

const KINDS = [['film', 'Film'], ['show', 'Show'], ['music', 'Music'], ['book', 'Book'], ['game', 'Game'], ['other', 'Other']];
const DID = { film: 'Watched', show: 'Watched', music: 'Listened', book: 'Read', game: 'Played', other: 'Enjoyed' };
const TODAY = { film: 'Watched today', show: 'Watched today', music: 'Heard today', book: 'Read today', game: 'Played today', other: 'Enjoyed today' };
const control = 'min-h-[44px]';
const small = `${quietButtonClass} ${control} inline-flex items-center justify-center`;

/**
 * The Lists tab: the person's own lists (Wanted and To watch, read or hear first, then the ones they made) and the
 * ones the household shared. A list can hold films, shows, music, books and games together, in the order the person
 * chose. A title on a list that is not owned stays out of the Collection until a copy is added.
 */
export default function ListsPage() {
  const [lists, setLists] = useState(null);
  const [making, setMaking] = useState(false);
  const [letterboxd, setLetterboxd] = useState(false);
  const [form, setForm] = useState({ name: '', shared: false });
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const load = useCallback(() => { axios.get('/api/media/lists').then(({ data }) => setLists(data)).catch(() => setLists([])); }, []);
  useEffect(() => { load(); }, [load]);
  if (!lists) return null;
  const make = async (e) => {
    e.preventDefault();
    setError('');
    try { const { data } = await axios.post('/api/media/lists', { name: form.name, shared: form.shared }); navigate(`/media/lists/${data.id}`); } catch (err) { setError(errorMessage(err, "That list couldn't be made. Try again.")); }
  };
  const mine = lists.filter((l) => l.mine);
  const theirs = lists.filter((l) => !l.mine);
  const row = (l) => (
    <li key={l.id}>
      <Link to={`/media/lists/${l.id}`} className={`flex ${control} items-center gap-3 rounded-xl px-3 py-2 hover:bg-life-50 dark:hover:bg-life-700`}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-800 dark:text-life-50">{l.name}</span>
          <span className="block text-xs text-gray-500 dark:text-life-300">
            {l.count === 0 ? 'Nothing on it yet' : `${l.count} ${l.count === 1 ? 'title' : 'titles'}`}
            {l.owner_name ? ` · shared by ${l.owner_name}` : l.shared ? ' · shared with the household' : ''}
          </span>
        </span>
        <span aria-hidden="true" className="text-life-500">›</span>
      </Link>
    </li>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Lists</h1>
        <button type="button" onClick={() => setLetterboxd(!letterboxd)} aria-expanded={letterboxd} className={`${quietButtonClass} ${control}`}>From Letterboxd</button>
        <button type="button" onClick={() => setMaking(!making)} aria-expanded={making} className={`${buttonClass} ${control}`}>+ New list</button>
      </div>
      {letterboxd && <LetterboxdIn onDone={load} />}
      <p className="text-sm text-gray-600 dark:text-life-200">
        Put any title on a list, whether you own it or not: films, shows, music, books and games together. A title you do not own is not counted in your collection until you add a copy.
      </p>
      {making && (
        <form onSubmit={make} className={`${cardClass} space-y-3`} data-new-list>
          <Field label="Name of the list"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} required placeholder="Rainy day, Gift ideas, Family movie night" className={inputClass} autoFocus /></Field>
          <label className={`flex ${control} items-center gap-2 text-sm text-gray-700 dark:text-life-100`}>
            <input type="checkbox" checked={form.shared} onChange={(e) => setForm({ ...form, shared: e.target.checked })} className="h-5 w-5 accent-life-600" /> Share with the household
          </label>
          <p className="text-xs text-gray-500 dark:text-life-300">Shared: everyone who signs in here can see it and add titles to it. Not shared: only you see it.</p>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className={`${buttonClass} ${control}`}>Make the list</button>
        </form>
      )}
      <section className={cardClass} aria-label="Your lists">
        <ul className="space-y-1">{mine.map(row)}</ul>
      </section>
      {theirs.length > 0 && (
        <section className={cardClass} aria-label="Shared with you">
          <h2 className="mb-1 text-sm font-semibold text-life-800 dark:text-life-50">Shared with you</h2>
          <ul className="space-y-1">{theirs.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

/** One open list: its titles in order, with a way to add, move, take off, mark as done and say "I have it now". */
export function ListPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(undefined);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [ordering, setOrdering] = useState(false);
  const [byRating, setByRating] = useState(false);
  const [filed, setFiled] = useState('');
  const load = useCallback(() => { axios.get(`/api/media/lists/${id}`).then(({ data }) => { setList(data); setName(data.name); }).catch(() => setList(null)); }, [id]);
  useEffect(() => { load(); }, [load]);
  if (list === undefined) return null;
  if (list === null) return <p className="text-sm text-gray-600 dark:text-life-200">That list isn't here anymore. It may have been deleted. <Link to="/media/lists" className="underline">All the lists</Link></p>;
  const run = async (promise) => {
    setError('');
    try { const { data } = await promise; setList(data); setName(data.name); } catch (err) { setError(errorMessage(err, "That didn't work. Try again in a moment.")); }
  };
  const act = (path, body) => run(axios.post(`/api/media/lists/${id}/${path}`, body));
  // Watched, read or heard today: it goes in the person's own log (on a shared list it comes off for everyone).
  // Wanted titles are not on a shelf yet, so there the owner's own title is logged.
  const watched = async (e) => {
    setError('');
    const day = toDateInput(new Date());
    if (list.builtin !== 'wanted') return act('watched', { media_id: e.media_id, day });
    try { await axios.post(`/api/media/${e.media_id}/log`, { day }); load(); } catch (err) { setError(errorMessage(err, "That didn't work. Try again in a moment.")); }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the list ${list.name}? No title is removed: the ones you do not own stay in search and can go on another list.`)) return;
    try { await axios.delete(`/api/media/lists/${id}`); navigate('/media/lists'); } catch (err) { setError(errorMessage(err, "That didn't work. Try again in a moment.")); }
  };
  const makeFile = async () => {
    setError(''); setFiled('');
    try {
      const { data } = await axios.get(`/api/media/lists/${id}/letterboxd`);
      const left = data.left_out ? ` ${data.left_out} other ${data.left_out === 1 ? 'title was' : 'titles were'} left out: only films go to Letterboxd.` : '';
      if (data.films === 0) { setFiled(`There is no film on this list, so there is nothing to put in a file for Letterboxd.${left}`); return; }
      const { handOver } = await import('../device/handOver.js');
      await handOver(new TextEncoder().encode(data.csv), data.file_name);
      setFiled(`Saved ${data.films} ${data.films === 1 ? 'film' : 'films'} as ${data.file_name}.${left} On Letterboxd, use its Import your data page and choose the file.`);
    } catch (err) { setError(errorMessage(err, "That file couldn't be made. Try again.")); }
  };
  const custom = list.mine && !list.builtin;
  const ordered = list.builtin !== 'wanted';
  const canOrder = ordered && !byRating && list.entries.length > 1;
  const shownEntries = byRating ? [...list.entries].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1)) : list.entries;
  const hasStars = list.entries.some((e) => e.stars != null);
  return (
    <div className="space-y-4">
      <div>
        <Link to="/media/lists" className={`inline-flex ${control} items-center text-sm text-life-600 hover:underline dark:text-life-200`}>← Lists</Link>
        <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{list.name}</h1>
        <p className="text-sm text-gray-500 dark:text-life-300">
          {list.count === 0 ? 'Nothing on it yet' : `${list.count} ${list.count === 1 ? 'title' : 'titles'}`}
          {list.owner_name ? ` · shared by ${list.owner_name}` : list.shared ? ' · shared with the household' : list.builtin ? '' : ' · only you see it'}
          {list.builtin === 'wanted' ? ' · kept in alphabetical order' : ''}
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {list.entries.length > 0 && <button type="button" onClick={makeFile} className={small} data-letterboxd-out>Make a Letterboxd file</button>}
        {list.mine && hasStars && <button type="button" onClick={() => { setByRating(!byRating); setOrdering(false); }} aria-pressed={byRating} className={byRating ? `${buttonClass} ${control}` : small}>{byRating ? 'Sorted by my rating' : 'Sort by my rating'}</button>}
      </div>
      {filed && <p role="status" className="text-sm text-gray-700 dark:text-life-100" data-letterboxd-said>{filed}</p>}
      {canOrder && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setOrdering(!ordering)} aria-pressed={ordering} className={ordering ? `${buttonClass} ${control}` : small}>{ordering ? 'Done' : 'Change order'}</button>
          {ordering && <span className="text-xs text-gray-500 dark:text-life-300">Use the arrows, then tap Done.</span>}
        </div>
      )}
      <AddToList list={list} onAdd={(body) => act('titles', body)} />
      {list.entries.length > 0 && (
        <section className={cardClass} aria-label="Titles on the list">
          <ol className="divide-y divide-life-50 dark:divide-life-700">
            {shownEntries.map((e, i) => (
              <li key={e.media_id} className="space-y-1 py-2" data-entry>
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex-none text-life-600 dark:text-life-200" aria-hidden="true"><Icon of={e.type} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-800 dark:text-life-50">
                      {list.mine ? <Link to={`/media/${e.media_id}`} className={`inline-flex ${control} items-center hover:underline`}>{e.title}</Link> : e.title}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-life-300">
                      <Dots parts={[KINDS.find(([k]) => k === e.type)?.[1], e.creator, e.year, e.added_by && `added by ${e.added_by}`, e.owned === false && 'not owned yet', e.owned === true && 'you have it', e.times > 0 && `${DID[e.type].toLowerCase()} ${e.times} ${e.times === 1 ? 'time' : 'times'}`, e.stars != null && <span key="stars" aria-label={`rated ${e.stars} out of 5`}>{starsText(e.stars)}</span>]} />
                    </span>
                    {e.note && <span className="block whitespace-pre-wrap text-xs text-gray-700 dark:text-life-100">{e.note}</span>}
                  </span>
                </div>
                {ordering && ordered ? (
                  <div className="flex flex-wrap items-center gap-2 pl-7">
                    <button type="button" disabled={i === 0} onClick={() => act('move', { media_id: e.media_id, way: 'up' })} aria-label={`Move ${e.title} up`} className={`${small} w-11 disabled:opacity-40`}>↑</button>
                    <button type="button" disabled={i === list.entries.length - 1} onClick={() => act('move', { media_id: e.media_id, way: 'down' })} aria-label={`Move ${e.title} down`} className={`${small} w-11 disabled:opacity-40`}>↓</button>
                  </div>
                ) : (
                  <EntryActions list={list} entry={e} onWatched={() => watched(e)} onTake={() => act('take', { media_id: e.media_id })} />
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
      {custom && (
        <section className={`${cardClass} space-y-3`} aria-label="About this list">
          <form onSubmit={(ev) => { ev.preventDefault(); run(axios.put(`/api/media/lists/${id}`, { name })); }} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1"><Field label="Name"><input value={name} onChange={(ev) => setName(ev.target.value)} maxLength={80} className={inputClass} /></Field></div>
            <button className={`${quietButtonClass} ${control}`} disabled={!name.trim() || name === list.name}>Rename</button>
          </form>
          <label className={`flex ${control} items-center gap-2 text-sm text-gray-700 dark:text-life-100`}>
            <input type="checkbox" checked={list.shared} onChange={(ev) => run(axios.put(`/api/media/lists/${id}`, { shared: ev.target.checked }))} className="h-5 w-5 accent-life-600" /> Share with the household
          </label>
          <p className="text-xs text-gray-500 dark:text-life-300">Shared: everyone who signs in here can see this list, add titles, take any off, change the order and mark one watched. Only you can rename it, stop sharing it or delete it. Not shared: only you see it, in search and in your downloads too.</p>
          <button type="button" onClick={remove} className={`${control} text-sm text-red-600 hover:underline`}>Delete this list</button>
        </section>
      )}
      {!list.mine && <p className="text-xs text-gray-500 dark:text-life-300">This list is shared with the household. You can add titles, take any off, change the order and mark one watched. Only {list.owner_name} can rename it, stop sharing it or delete it.</p>}
    </div>
  );
}

/** Type a title onto a list (any kind), or, on your own list, pick one you already have. */
function AddToList({ list, onAdd }) {
  const empty = { type: 'film', title: '', year: '', note: '' };
  const [form, setForm] = useState(empty);
  const [picking, setPicking] = useState(false);
  const [owned, setOwned] = useState(null);
  const [find, setFind] = useState('');
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    await onAdd({ type: form.type, title: form.title, year: form.year === '' ? null : Number(form.year), note: form.note || null });
    setForm({ ...empty, type: form.type });
  };
  const openPicker = () => {
    setPicking(!picking);
    if (owned === null) axios.get('/api/media').then(({ data }) => setOwned(data)).catch(() => setOwned([]));
  };
  const word = find.trim().toLowerCase();
  const onList = new Set(list.entries.map((x) => x.media_id));
  const matches = (owned ?? []).filter((m) => !onList.has(m.id) && (!word || `${m.title} ${m.creator ?? ''}`.toLowerCase().includes(word))).slice(0, 8);
  return (
    <section className={`${cardClass} space-y-3`} aria-label="Add a title">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Kind"><select value={form.type} onChange={set('type')} className={`${inputClass} ${control}`}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></Field>
          <div className="col-span-2"><Field label="Title"><input value={form.title} onChange={set('title')} maxLength={300} required className={`${inputClass} ${control}`} placeholder="Type any title" /></Field></div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Year (if you like)"><input type="number" min="0" max="9999" step="1" value={form.year} onChange={set('year')} className={`${inputClass} ${control}`} /></Field>
          <div className="col-span-2"><Field label="Note (if you like)"><input value={form.note} onChange={set('note')} maxLength={1000} className={`${inputClass} ${control}`} /></Field></div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={`${buttonClass} ${control}`}>Add to the list</button>
          {list.mine && list.builtin !== 'wanted' && <button type="button" onClick={openPicker} aria-expanded={picking} className={`${quietButtonClass} ${control}`}>Pick one I own</button>}
        </div>
      </form>
      {picking && (
        <div className="space-y-2" data-picker>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find in your collection" aria-label="Find in your collection" className={`${inputClass} ${control}`} />
          {owned && matches.length === 0 && <p className="text-sm text-gray-500 dark:text-life-200">Nothing to pick.</p>}
          <ul className="space-y-1">
            {matches.map((m) => (
              <li key={m.id}><button type="button" onClick={() => onAdd({ media_id: m.id })} className={`flex ${control} w-full items-center gap-2 rounded-xl px-3 text-left text-sm hover:bg-life-50 dark:hover:bg-life-700`}><Icon of={m.type} /> <span className="truncate">{m.title}</span>{m.year ? <span className="text-xs text-gray-500 dark:text-life-300">{m.year}</span> : null}</button></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * One title's buttons: one main button, then More. Main is "Watched today" (by kind), or "I have it now" on Wanted.
 * More holds the rest: the other of those two, and Take off.
 */
function EntryActions({ list, entry: e, onWatched, onTake }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const more = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => { if (box.current && !box.current.contains(ev.target)) setOpen(false); };
    const key = (ev) => { if (ev.key === 'Escape') { setOpen(false); more.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  const wanted = list.builtin === 'wanted';
  const have = list.mine && e.owned === false;
  const haveLink = <Link to={`/media/${e.media_id}?copy=1`} className={small}>I have it now</Link>;
  const watchedButton = <button type="button" onClick={() => { setOpen(false); onWatched(); }} className={small}>{TODAY[e.type]}</button>;
  return (
    <div className="flex flex-wrap items-start gap-2 pl-7" ref={box}>
      {wanted ? haveLink : watchedButton}
      <button ref={more} type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true" aria-label={`More for ${e.title}`} className={small}>More</button>
      {open && (
        <div role="group" aria-label={`Other choices for ${e.title}`} className="flex w-full flex-wrap gap-2" data-more>
          {wanted ? watchedButton : have && haveLink}
          {e.can_remove && <button type="button" onClick={() => { setOpen(false); onTake(); }} aria-label={`Take ${e.title} off the list`} className={small}>Take off</button>}
        </div>
      )}
    </div>
  );
}
