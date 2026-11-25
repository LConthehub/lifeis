import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import Scanner from '../components/Scanner';
import { buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { serverOrigin } from '../where';
import { PrintInk, PrintStyleChoice } from '../print/PrintFrame';

/** The code out of a scanned sticker: the code itself, or an address ending in /p/ and the code. */
export const stickerCode = (read) => (/(?:^|\/p\/)([2-9A-HJ-NP-Za-hj-np-z]{10})\/?$/.exec(String(read).trim()) || [])[1]?.toUpperCase() || null;
const stickerAddress = (code) => `${serverOrigin()}/p/${code}`;

/** One place: the places inside it, and everything kept there, from your things and your collection. */
export function PlacePage() {
  const id = Number(useParams().id);
  const [places, setPlaces] = useState(null);
  const [things, setThings] = useState([]);
  const [titles, setTitles] = useState([]);
  useEffect(() => {
    axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => setPlaces([]));
    axios.get('/api/things/items', { params: { place_id: id } }).then(({ data }) => setThings(data)).catch(() => setThings([]));
    axios.get('/api/media', { params: { place_id: id } }).then(({ data }) => setTitles(data)).catch(() => setTitles([]));
  }, [id]);
  if (!places) return null;
  const place = places.find((p) => p.id === id);
  if (!place) return <p className="text-sm text-gray-500 dark:text-life-300">That place isn't there any more. <Link to="/things/places" className="underline">All places</Link></p>;
  const inside = places.filter((p) => p.parent_id === id);
  const above = places.find((p) => p.id === place.parent_id);
  // Something kept in a place inside this one says which.
  const deeper = (path) => (path && path !== place.path ? path.slice(place.path.length + 3) : null);
  return (
    <div className="space-y-4">
      <Link to={above ? `/things/places/${above.id}` : '/things/places'} className="text-sm text-life-600 hover:underline dark:text-life-200">← {above ? above.name : 'Places'}</Link>
      <div className="flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold text-life-800 dark:text-life-50"><Icon of="place" /> {place.name}</h1>
          {above && <p className="text-xs text-gray-500 dark:text-life-300">{place.path}</p>}
          {place.note && <p className="text-sm text-gray-600 dark:text-life-100">{place.note}</p>}
        </div>
        <Link to={`/things/places/${id}/fill`} className={buttonClass}><Icon of="scan" /> Fill this place</Link>
        <Link to={`/things/places/${id}/walk`} className={quietButtonClass}>Walk through this room</Link>
        <Link to={`/things/places/stickers?only=${id}`} className={quietButtonClass}>Print its sticker</Link>
        {things.length > 0 && <Link to={`/things/stickers?place=${id}`} className={quietButtonClass}>Stickers for what's here</Link>}
      </div>
      {inside.length > 0 && (
        <section className={cardClass}>
          <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Inside it</h2>
          <ul className="flex flex-wrap gap-2">
            {inside.map((p) => <li key={p.id}><Link to={`/things/places/${p.id}`} className="rounded-full bg-life-50 px-3 py-1 text-sm text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">{p.name}</Link></li>)}
          </ul>
        </section>
      )}
      <section className={cardClass}>
        <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Things kept here <span className="text-sm font-normal text-gray-500 dark:text-life-300">{things.length || ''}</span></h2>
        {things.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">None of your things are here.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {things.map((t) => (
              <li key={t.id} className="flex items-baseline gap-2 py-1.5 text-sm">
                <span aria-hidden="true">{t.icon}</span>
                <span className="flex-1 text-gray-800 dark:text-life-50"><Link to={`/things/${t.id}`} className="hover:underline">{t.name}</Link> <span className="text-xs text-gray-500 dark:text-life-300">{[t.kind, deeper(t.place)].filter(Boolean).join(' · ')}</span></span>
                <span className="text-gray-500 dark:text-life-300">{t.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={cardClass}>
        <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">From the collection <span className="text-sm font-normal text-gray-500 dark:text-life-300">{titles.length || ''}</span></h2>
        {titles.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">No films, music, books or games are kept here.</p> : (
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {titles.map((m) => (
              <li key={m.id}>
                <Link to={`/media/${m.id}`} className="flex items-baseline gap-2 py-1.5 text-sm hover:underline">
                  <Icon of={m.type} />
                  <span className="flex-1 text-gray-800 dark:text-life-50">{m.title}{m.year ? <span className="text-gray-500 dark:text-life-300"> ({m.year})</span> : null}</span>
                  <span className="text-xs text-gray-500 dark:text-life-300">{m.formats.join(', ')}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Where a sticker's address lands: straight on to the place it belongs to. */
export function StickerLanding() {
  const { code } = useParams();
  const [place, setPlace] = useState(null);
  useEffect(() => { axios.get('/api/things/places/sticker', { params: { code } }).then(({ data }) => setPlace(data)).catch(() => setPlace(false)); }, [code]);
  if (place === null) return null;
  if (place === false) return <p className="text-sm text-gray-700 dark:text-life-100">That sticker isn't for one of your places. <Link to="/things/places" className="underline">Your places</Link></p>;
  return <Navigate to={`/things/places/${place.id}`} replace />;
}

/** Scan a sticker (or a barcode on something you have) with the camera and go to its place or thing. */
export function ScanSticker() {
  const [round, setRound] = useState(0);
  const [problem, setProblem] = useState('');
  const navigate = useNavigate();
  const look = useCallback(async (read) => {
    try {
      const { data } = await axios.get('/api/things/scan', { params: { code: read } });
      if (data.kind === 'place') navigate(`/things/places/${data.place.id}`);
      else if (data.kind === 'thing') navigate(`/things/${data.item.id}`);
      else if (data.kind === 'copies') navigate(`/media/${data.copies[0].media_id}`);
      else if (data.kind === 'new-sticker') setProblem("This sticker isn't on anything yet. Open the place the thing is kept, choose Fill this place, and scan it there.");
      else setProblem(stickerCode(read) ? "That sticker isn't for one of your places." : "That isn't on anything you have yet. To add it, open its place and choose Fill this place.");
    } catch (err) { setProblem(errorMessage(err, "Couldn't look that up")); }
  }, [navigate]);
  if (problem) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-800 dark:text-life-50">{problem}</p>
        <button type="button" onClick={() => { setProblem(''); setRound(round + 1); }} className={quietButtonClass}>Scan another</button>
      </div>
    );
  }
  return <Scanner key={round} onCode={look} label="Point the camera at the sticker" />;
}

const SIZES = { small: ['Small, 4 across', 'grid-cols-4', 'text-[9px]'], medium: ['Medium, 3 across', 'grid-cols-3', 'text-[11px]'], large: ['Large, 2 across', 'grid-cols-2', 'text-sm'] };

/** A sheet of stickers to print: one for each place you check, each a code your camera reads to show what's inside. */
export function StickersPage() {
  const only = new URLSearchParams(window.location.search).get('only');
  const boxesOnly = new URLSearchParams(window.location.search).get('boxes');
  const [stickers, setStickers] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [pictures, setPictures] = useState({});
  const [size, setSize] = useState('medium');
  useEffect(() => {
    axios.get('/api/things/places/stickers').then(async ({ data }) => {
      setStickers(data);
      // Asked for the boxes alone (from Packing): only those still to be moved are checked.
      const boxes = boxesOnly ? new Set((await axios.get('/api/things/packing').catch(() => ({ data: { boxes: [] } }))).data.boxes.filter((b) => b.state !== 'unpacked').map((b) => b.id)) : null;
      setChosen(boxes ? data.filter((s) => boxes.has(s.id)).map((s) => s.id) : only ? data.filter((s) => String(s.id) === only).map((s) => s.id) : data.map((s) => s.id));
      // The drawing is done here, in the browser: nothing about your places goes to a code-making website.
      const { default: QRCode } = await import('qrcode');
      const made = {};
      for (const s of data) made[s.id] = await QRCode.toDataURL(stickerAddress(s.code), { errorCorrectionLevel: 'M', margin: 1, width: 480 });
      setPictures(made);
    }).catch(() => setStickers([]));
  }, [only]);
  if (!stickers) return null;
  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  const printing = stickers.filter((s) => chosen.includes(s.id));
  return (
    <div className="space-y-4">
      <div className="space-y-4 print:hidden">
        <Link to="/things/places" className="text-sm text-life-600 hover:underline dark:text-life-200">← Places</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Stickers for your places</h1>
          <select aria-label="Sticker size" value={size} onChange={(e) => setSize(e.target.value)} className="rounded-lg border border-life-200 bg-card px-3 py-1.5 text-sm text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50">
            {Object.entries(SIZES).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" disabled={printing.length === 0} onClick={() => window.print()} className={buttonClass}>Print {printing.length || ''}</button>
        </div>
        <PrintStyleChoice />
        <p className="text-sm text-gray-600 dark:text-life-100">
          Print these on sticker paper (or plain paper and tape), and put each on its shelf, box or bin. Point a phone's camera at one to see what's inside.
          Only someone signed in to your Life Is can see anything: to anyone else the sticker is just an address that asks them to sign in.
        </p>
        {stickers.length === 0 ? <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No places yet. Add a room, a shelf or a bin first.</div> : (
          <div className={`${cardClass} space-y-1`}>
            <div className="mb-1 flex gap-3 text-xs">
              <button type="button" onClick={() => setChosen(stickers.map((s) => s.id))} className="text-life-600 hover:underline dark:text-life-200">Check all</button>
              <button type="button" onClick={() => setChosen([])} className="text-life-600 hover:underline dark:text-life-200">Uncheck all</button>
            </div>
            {stickers.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 text-sm text-gray-800 dark:text-life-50">
                <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} className="accent-life-600" /> {s.path}
              </label>
            ))}
          </div>
        )}
      </div>
      {/* The sheet itself: black on white whatever the page's colors, and the only thing that prints. */}
      <PrintInk as="ul" className={`sticker-sheet grid gap-3 rounded-xl bg-card print:bg-white p-3 text-black ${SIZES[size][1]}`} aria-label="The stickers that will print">
        {printing.map((s) => (
          <li key={s.id} className="flex break-inside-avoid flex-col items-center rounded-lg border border-dashed border-gray-400 p-2 text-center">
            {pictures[s.id] ? <img src={pictures[s.id]} alt={`Sticker for ${s.path}`} data-code={s.code} className="w-full" /> : <span className="aspect-square w-full" />}
            <span className={`mt-1 font-semibold leading-tight ${SIZES[size][2]}`}>{s.name}</span>
            {s.path !== s.name && <span className={`leading-tight text-gray-600 ${SIZES[size][2]}`}>{s.path.slice(0, s.path.length - s.name.length - 3)}</span>}
          </li>
        ))}
      </PrintInk>
    </div>
  );
}
