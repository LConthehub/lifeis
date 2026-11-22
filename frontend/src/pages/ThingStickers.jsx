import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import axios from 'axios';
import { buttonClass, cardClass } from '../components/ui';
import { serverOrigin } from '../where';

/** What a thing's sticker carries: an address ending in /t/ and its code, so a phone's camera opens it. */
export const thingStickerAddress = (code) => `${serverOrigin()}/t/${code}`;
const SIZES = { small: ['Small, 5 across', 'grid-cols-5', 'text-[8px]'], medium: ['Medium, 4 across', 'grid-cols-4', 'text-[10px]'], large: ['Large, 3 across', 'grid-cols-3', 'text-xs'] };

/**
 * A sheet of stickers for things: for the things named (?ids=1,2), the things in a place (?place=3), or
 * blank ones (?blank=40) to stick on first and say what each is on when it's scanned.
 */
export function ThingStickersPage() {
  const query = new URLSearchParams(window.location.search);
  const ids = query.get('ids');
  const place = query.get('place');
  const blank = Number(query.get('blank')) || 0;
  const [stickers, setStickers] = useState(null);
  const [pictures, setPictures] = useState({});
  const [size, setSize] = useState('medium');

  useEffect(() => {
    (async () => {
      let made;
      if (blank) {
        made = (await axios.get('/api/things/stickers/blank', { params: { count: blank } })).data.map((code) => ({ code, name: '', place: null }));
      } else {
        const wanted = ids ? ids.split(',').map(Number).filter(Boolean)
          : (await axios.get('/api/things/items', { params: { place_id: place } })).data.map((t) => t.id);
        made = wanted.length ? (await axios.post('/api/things/stickers', { ids: wanted })).data : [];
      }
      setStickers(made);
      // Drawn here, in the browser: nothing about your things goes to a code-making website.
      const { default: QRCode } = await import('qrcode');
      const drawn = {};
      for (const s of made) drawn[s.code] = await QRCode.toDataURL(thingStickerAddress(s.code), { errorCorrectionLevel: 'M', margin: 1, width: 360 });
      setPictures(drawn);
    })().catch(() => setStickers([]));
  }, [ids, place, blank]);

  if (!stickers) return null;
  return (
    <div className="space-y-4">
      <div className="space-y-3 print:hidden">
        <Link to="/things" className="text-sm text-life-600 hover:underline dark:text-life-200">← Things</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">{blank ? 'Blank stickers for things' : 'Stickers for your things'}</h1>
          <select aria-label="Sticker size" value={size} onChange={(e) => setSize(e.target.value)} className="rounded-lg border border-life-200 bg-white px-3 py-1.5 text-sm text-gray-800 dark:border-life-700 dark:bg-life-800 dark:text-life-50">
            {Object.entries(SIZES).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <button type="button" disabled={!stickers.length} onClick={() => window.print()} className={buttonClass}>Print {stickers.length || ''}</button>
        </div>
        <p className="text-sm text-gray-600 dark:text-life-100">
          {blank ? 'Stick these on things first. Then fill a place and scan each one: Life Is asks what it is on, once, and after that the sticker finds it.'
            : "Stick each on its thing. A phone's camera then opens it in Life Is, and scanning it while filling a place moves it there."}
          {' '}Only someone signed in to your Life Is can see anything.
        </p>
        {!stickers.length && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No things to make stickers for.</div>}
      </div>
      <ul className={`sticker-sheet grid gap-2 rounded-xl bg-white p-3 text-black ${SIZES[size][1]}`} aria-label="The stickers that will print">
        {stickers.map((s) => (
          <li key={s.code} className="flex break-inside-avoid flex-col items-center rounded-lg border border-dashed border-gray-400 p-1.5 text-center">
            {pictures[s.code] ? <img src={pictures[s.code]} alt={s.name ? `Sticker for ${s.name}` : 'A blank sticker'} data-code={s.code} className="w-full" /> : <span className="aspect-square w-full" />}
            <span className={`mt-0.5 font-semibold leading-tight ${SIZES[size][2]}`}>{s.name || s.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Where a thing's sticker opens: that thing, or, for a blank one, the offer to say what it's on. */
export function ThingStickerLanding() {
  const { code } = useParams();
  const [found, setFound] = useState(null);
  useEffect(() => { axios.get('/api/things/scan', { params: { code: `/t/${code}` } }).then(({ data }) => setFound(data)).catch(() => setFound({ kind: 'unknown' })); }, [code]);
  if (!found) return null;
  if (found.kind === 'thing') return <Navigate to={`/things/${found.item.id}`} replace />;
  if (found.kind === 'new-sticker') {
    return (
      <div className={`${cardClass} space-y-2 text-sm text-gray-700 dark:text-life-100`}>
        <p>This sticker isn't on anything yet.</p>
        <p>To say what it's on, open the place the thing is kept and choose <span className="font-medium">Fill this place</span>, then scan the sticker. <Link to="/things/places" className="underline">Your places</Link></p>
      </div>
    );
  }
  return <p className="text-sm text-gray-700 dark:text-life-100">That sticker isn't for one of your things. <Link to="/things" className="underline">Your things</Link></p>;
}
