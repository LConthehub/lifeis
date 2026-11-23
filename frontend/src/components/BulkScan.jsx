import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import PlacePicker from './PlacePicker';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

const TYPE_CHOICES = [['film', '🎬 Film'], ['show', '📺 Show'], ['music', '🎵 Music'], ['book', '📚 Book'], ['game', '🎮 Game'], ['other', '🗃 Something else']];
const SLOW_AFTER_MS = 4000;     // after this long a lookup is called slow
const PAUSE_MS = 500;           // a breath between lookups: the free services are asked kindly, one at a time

// The same barcode however it was scanned: spaces and dashes don't matter, and a 12-digit UPC is its 13-digit EAN with a 0 in front.
const codeKey = (code) => { const p = code.replace(/[\s-]/g, '').toUpperCase(); return /^\d{12}$/.test(p) ? `0${p}` : p; };

const cameraTrouble = (problem) => {
  const name = problem?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return "The camera wasn't allowed. Allow it for this site in your browser's settings, or type each number below.";
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found on this device. Type each number below.';
  if (name === 'NotReadableError') return 'The camera is in use by something else. Close that, or type each number below.';
  return "The camera couldn't be started. Type each number below.";
};

/**
 * A camera that stays open: every barcode it reads is handed on (the same one seen again within a few seconds is
 * one reading, not many). Typing a number works too, which is also how a handheld scanner sends it, and is the
 * way in for a computer with no camera. The picture is read on this device and goes nowhere.
 */
function KeepScanning({ onCode }) {
  const video = useRef(null);
  const last = useRef({ code: '', at: 0 });
  const give = useRef(onCode);
  give.current = onCode;
  const [state, setState] = useState('starting');   // starting, looking, or a sentence saying what went wrong
  const [typed, setTyped] = useState('');
  const field = useRef(null);
  useEffect(() => {
    let controls = null;
    let gone = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setState(window.isSecureContext ? 'This browser has no camera to offer. Type each number below.' : 'The camera only works when Life Is is opened over https (or on this computer itself). Type each number below.');
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (gone) return;
        const started = await new BrowserMultiFormatReader().decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          video.current, (result) => {
            const code = result?.getText().trim();
            if (!code) return;
            const now = Date.now();
            if (code === last.current.code && now - last.current.at < 3000) { last.current.at = now; return; }
            last.current = { code, at: now };
            give.current(code);
          });
        if (gone) started.stop(); else { controls = started; setState('looking'); }
      } catch (problem) {
        if (!gone) setState(cameraTrouble(problem));
      }
    })();
    return () => { gone = true; controls?.stop(); };
  }, []);
  const working = state === 'starting' || state === 'looking';
  const submit = (e) => {
    e.preventDefault();
    const code = typed.trim();
    if (!code) return;
    give.current(code);
    setTyped('');
    field.current?.focus();
  };
  return (
    <div className="space-y-3">
      {working ? (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={video} muted playsInline className="aspect-video w-full object-cover" aria-label="What the camera sees" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-coral/80" />
          <p className="absolute inset-x-0 bottom-0 bg-black/50 px-3 py-1.5 text-center text-xs text-white">{state === 'starting' ? 'Starting the camera…' : 'Point the camera at one barcode after another'}</p>
        </div>
      ) : <p role="alert" className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">{state}</p>}
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="flex-1 text-xs text-gray-600 dark:text-life-200">Or type a barcode
          <input ref={field} inputMode="numeric" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} className={`${inputClass} mt-1 min-h-[44px]`} />
        </label>
        <button type="submit" className={`${quietButtonClass} min-h-[44px]`}>Add to the list</button>
      </form>
      <p className="text-[11px] text-gray-400 dark:text-life-400">The picture is read on this device and never sent anywhere.</p>
    </div>
  );
}

/**
 * Scan many: the camera stays open and each barcode joins a running list as a draft line. Each one is looked
 * up the way a single scan is (`lookUp`, passed in, and the collection's own barcode check), one at a time and
 * never together. A barcode already in the collection says so and is not added unless asked. Lines can be
 * edited or removed, a place chosen once, and then they are all added.
 */
export default function BulkScan({ lookUp, ignoreCode, defaultType = 'film', onDone }) {
  const [lines, setLines] = useState([]);
  const [note, setNote] = useState('');
  const [place, setPlace] = useState('');
  const [places, setPlaces] = useState([]);
  const [batchFormat, setBatchFormat] = useState('');
  const [slow, setSlow] = useState(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(0);
  const [error, setError] = useState('');
  const [turning, setTurning] = useState(false);
  const seen = useRef(new Set());
  const queue = useRef([]);
  const running = useRef(false);
  const alive = useRef(true);
  const gone = useRef(new Set());    // lines taken off the list before their turn came
  const linesRef = useRef(lines);
  linesRef.current = lines;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { axios.get('/api/things/places').then(({ data }) => setPlaces(data)).catch(() => {}); }, []);
  const patch = useCallback((key, change) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...change } : l))), []);

  const examine = useCallback(async (code) => {
    const { data } = await axios.get('/api/media/barcode', { params: { code } });
    if (data.length) return { state: 'have', have: data, format: data[0].format || '' };
    const found = await lookUp(code);
    if (found.start) {
      return { state: 'found', from: found.from, type: found.start.type || defaultType, title: found.start.title || '', creator: found.start.creator || '', year: found.start.year ?? '', format: found.start.format || '' };
    }
    return { state: 'blank', hint: found.hint || '', offer: found.offer || null };
  }, [lookUp, defaultType]);

  // One lookup at a time, with a breath between: never a burst of them at a free service.
  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (alive.current && queue.current.length) {
      const { key, code } = queue.current.shift();
      if (gone.current.has(key)) continue;
      patch(key, { state: 'looking' });
      const timer = setTimeout(() => { if (alive.current) setSlow(key); }, SLOW_AFTER_MS);
      try { patch(key, await examine(code)); } catch (err) { patch(key, { state: 'blank', hint: errorMessage(err, "It couldn't be looked up just now.") }); }
      clearTimeout(timer);
      if (alive.current) setSlow(null);
      await new Promise((done) => { setTimeout(done, PAUSE_MS); });
    }
    running.current = false;
  }, [examine, patch]);

  const onCode = useCallback((raw) => {
    const code = raw.trim();
    if (!code) return;
    if (ignoreCode?.(code)) { setNote("That's a sticker for a place, not for a title. Nothing was added for it."); return; }
    const key = codeKey(code);
    if (seen.current.has(key)) { setNote(`You already scanned ${code} in this list, so it's there once.`); return; }
    seen.current.add(key);
    gone.current.delete(key);
    setNote('');
    setLines((all) => [...all, { key, code, state: 'queued', type: defaultType, title: '', creator: '', year: '', format: '', have: [], another: false, hint: '', offer: null, from: '', error: '' }]);
    queue.current.push({ key, code });
    pump();
  }, [defaultType, ignoreCode, pump]);

  const remove = (line) => { gone.current.add(line.key); seen.current.delete(line.key); queue.current = queue.current.filter((q) => q.key !== line.key); setLines((all) => all.filter((l) => l.key !== line.key)); };
  const waiting = lines.some((l) => l.state === 'queued' || l.state === 'looking');
  const ready = (l) => (l.state === 'have' ? l.another && Boolean((l.format || batchFormat).trim())
    : (l.state === 'found' || l.state === 'blank') && Boolean(l.title.trim()) && Boolean((l.format || batchFormat).trim()));
  const readyLines = lines.filter(ready);
  const notReady = lines.filter((l) => !ready(l) && !(l.state === 'have' && !l.another) && l.state !== 'queued' && l.state !== 'looking');
  const offers = [...new Map(lines.filter((l) => l.offer).map((l) => [l.offer.which, l.offer])).values()];

  const turnOn = async (offer) => {
    setTurning(true);
    setError('');
    try {
      await axios.put('/api/lookups', { [offer.which]: true });
      const again = linesRef.current.filter((l) => l.offer?.which === offer.which);
      for (const l of again) { patch(l.key, { state: 'queued', offer: null, hint: '' }); queue.current.push({ key: l.key, code: l.code }); }
      pump();
    } catch (err) { setError(errorMessage(err, "Couldn't turn that on")); }
    setTurning(false);
  };

  const addAll = async () => {
    setAdding(true);
    setError('');
    let count = 0;
    for (const l of readyLines) {
      const format = (l.format || batchFormat).trim();
      const at = place === '' ? null : Number(place);
      try {
        if (l.state === 'have') await axios.post(`/api/media/${l.have[0].id}/copies`, { format, place_id: at, barcode: l.code });
        else await axios.post('/api/media', { type: l.type, title: l.title.trim(), creator: l.creator || null, year: l.year === '' ? null : Number(l.year), copy: { format, place_id: at, barcode: l.code } });
        count += 1;
        setLines((all) => all.filter((x) => x.key !== l.key));
      } catch (err) { patch(l.key, { error: errorMessage(err, "Couldn't add this one") }); }
    }
    setAdded((n) => n + count);
    setAdding(false);
  };

  return (
    <div className="space-y-4">
      <KeepScanning onCode={onCode} />
      {note && <p role="status" className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">{note}</p>}
      {offers.map((offer) => (
        <div key={offer.which} className="space-y-2 rounded-lg border border-life-200 p-3 text-sm text-gray-700 dark:border-life-700 dark:text-life-100">
          <p>Life Is can fill in what these are, by asking {offer.name}, one barcode at a time. <span className="font-medium">What it's sent:</span> {offer.sends}</p>
          <button type="button" onClick={() => turnOn(offer)} disabled={turning} className={`${quietButtonClass} min-h-[44px]`}>{turning ? 'Turning it on…' : 'Turn that on and look them up'}</button>
          <p className="text-xs text-gray-500 dark:text-life-300">It stays on for next time. Turn it off in Settings, under Outside services.</p>
        </div>
      ))}
      {added > 0 && <p role="status" className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">Added {added} to the collection.</p>}
      {lines.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Where they all go"><div className="[&_button]:min-h-[44px] [&_input]:min-h-[44px] [&_select]:min-h-[44px]"><PlacePicker value={place} places={places} onPlaces={setPlaces} onChange={setPlace} /></div></Field>
            <Field label="They are all on (for any line that doesn't say)"><input value={batchFormat} onChange={(e) => setBatchFormat(e.target.value)} placeholder="DVD, CD, Paperback…" className={`${inputClass} min-h-[44px]`} /></Field>
          </div>
          <ul className="space-y-2" aria-label="Scanned so far">
            {lines.map((l) => (
              <li key={l.key} data-line className="space-y-2 rounded-lg border border-life-100 p-3 text-sm dark:border-life-700">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-xs text-gray-500 dark:text-life-300">
                    <span className="font-mono">{l.code}</span>
                    {l.state === 'queued' && ' · waiting its turn'}
                    {l.state === 'looking' && ' · looking it up…'}
                    {l.state === 'found' && ` · ${l.from} says it's:`}
                  </p>
                  <button type="button" onClick={() => remove(l)} aria-label={`Remove barcode ${l.code} from the list`} className="-mr-2 -mt-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-gray-400 hover:bg-life-50 hover:text-red-600 dark:hover:bg-life-700">✕</button>
                </div>
                {slow === l.key && <p className="text-xs text-honey-700">This one is slow. The free lookup services can be, and they're asked one at a time. Still waiting…</p>}
                {l.state === 'have' && (
                  <>
                    <p className="font-medium text-life-800 dark:text-life-50">You have this: {l.have.map((m) => `${m.title}${m.year ? ` (${m.year})` : ''}, ${m.format}`).join('; ')}</p>
                    <label className="flex min-h-[44px] items-center gap-2 text-gray-700 dark:text-life-100">
                      <input type="checkbox" checked={l.another} onChange={(e) => patch(l.key, { another: e.target.checked })} className="h-5 w-5 accent-life-600" /> Add another copy of it
                    </label>
                    {l.another && <Field label="What the new copy is on"><input value={l.format} onChange={(e) => patch(l.key, { format: e.target.value })} className={`${inputClass} min-h-[44px]`} /></Field>}
                  </>
                )}
                {l.state === 'blank' && <p className="text-gray-700 dark:text-life-100">Not found: barcode {l.code}.{l.hint ? ` ${l.hint}` : ' Type a title for it.'}</p>}
                {(l.state === 'found' || l.state === 'blank') && (
                  <div className="space-y-2">
                    <Field label={`Title for barcode ${l.code}`}><input value={l.title} onChange={(e) => patch(l.key, { title: e.target.value })} className={`${inputClass} min-h-[44px]`} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="What it is">
                        <select value={l.type} onChange={(e) => patch(l.key, { type: e.target.value })} className={`${inputClass} min-h-[44px]`}>{TYPE_CHOICES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                      </Field>
                      <Field label="What it's on"><input value={l.format} onChange={(e) => patch(l.key, { format: e.target.value })} placeholder={batchFormat || 'Blu-ray, CD…'} className={`${inputClass} min-h-[44px]`} /></Field>
                    </div>
                    {l.creator && <p className="text-xs text-gray-500 dark:text-life-300">{[l.creator, l.year].filter(Boolean).join(' · ')}</p>}
                  </div>
                )}
                {l.error && <p className="text-xs text-red-600">{l.error}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {lines.length === 0 && added === 0 && <p className="text-sm text-gray-500 dark:text-life-300">Scan one barcode after another. Each shows up here, and nothing is added until you say so.</p>}
      {notReady.length > 0 && !waiting && <p className="text-xs text-gray-500 dark:text-life-300">{notReady.length === 1 ? '1 line needs a title and what it\'s on' : `${notReady.length} lines need a title and what they're on`} before it can be added; until then it is left out.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={() => onDone(added)} className={`${quietButtonClass} min-h-[44px]`}>{added > 0 && lines.length === 0 ? 'Done' : 'Close'}</button>
        <button type="button" onClick={addAll} disabled={adding || waiting || readyLines.length === 0} className={`${buttonClass} min-h-[44px]`}>{adding ? 'Adding…' : `Add these ${readyLines.length}`}</button>
      </div>
    </div>
  );
}
