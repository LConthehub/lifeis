import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { cardClass, errorMessage } from './ui';
import { LifeAreasPicker } from './LifeAreas';

// The two-minute start: a few short questions for a household that is just beginning. Every step is saved when
// Next is pressed (server/src/startRoutes.ts), so closing part way keeps what was done and the front page offers
// to finish. "Skip, show me everything" is on every step and does what it always did.

const primary = 'min-h-[44px] rounded-full bg-gradient-to-br from-life-500 to-life-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:from-life-600 hover:to-life-800 disabled:opacity-50';
const quiet = 'min-h-[44px] rounded-lg border border-life-200 px-3 py-2 text-sm text-life-700 hover:bg-life-50 disabled:opacity-50 dark:border-life-700 dark:text-life-100 dark:hover:bg-life-800';
const field = 'min-h-[44px] w-full rounded-lg border border-life-200 bg-card px-3 py-2 text-base text-gray-800 focus:border-life-500 focus:outline-none focus:ring-2 focus:ring-life-200 dark:border-life-700 dark:bg-life-800 dark:text-life-50';
const row = 'flex min-h-[44px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 text-sm';
const picked = (on) => `${row} ${on ? 'border-life-300 bg-life-50 dark:border-life-500 dark:bg-life-700' : 'border-gray-200 dark:border-life-700'}`;
const tick = 'mt-0.5 h-5 w-5 shrink-0 accent-life-600';

/** Said when the start has changed what the front page shows, so it reads again without a reload. */
export const START_CHANGED = 'lifeis:start-changed';
const names = (text) => text.split(/[,;\n]/).map((n) => n.trim()).filter(Boolean);
const FIRST = ['meals', 'things', 'house'];

/** The shell: a dialog with a name, closed by Escape or the close button, scrolling inside itself. */
function Shell({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[92vh] max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-card p-4 shadow-xl dark:bg-life-800 sm:max-w-lg sm:rounded-2xl sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-life-800 dark:text-life-50">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none text-gray-400 hover:text-gray-600">×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** The guided start. `fresh`: opened from the front page, where the sections shown above it may need a reload. */
export function StartDialog({ onDone, onClose, fresh = false }) {
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [step, setStep] = useState(1);
  const [adults, setAdults] = useState('');
  const [children, setChildren] = useState('');
  const [pets, setPets] = useState([]);
  const [wants, setWants] = useState(FIRST);
  const [hobbies, setHobbies] = useState([]);
  const [hasCar, setHasCar] = useState(null);
  const [sets, setSets] = useState(['house']);
  const [sample, setSample] = useState(true);
  const [problem, setProblem] = useState(null);
  // The first question, before the numbered steps: shown until it is answered or passed by.
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [finished, setFinished] = useState(null);
  const [everything, setEverything] = useState(false);
  const touched = useRef(false);
  const heading = useRef(null);

  useEffect(() => {
    axios.get('/api/start').then(({ data }) => {
      setS(data);
      const a = data.answers;
      setStep(Math.min(Math.max(data.step || 1, 1), 4));
      setAdults(a.adults.join(', '));
      setChildren(a.children.join(', '));
      setPets(a.pets);
      if (a.wants.length > 0 || data.step > 2) { setWants(a.wants); setHobbies(a.hobbies); }
      setHasCar(a.has_car);
      if (a.sets.length > 0) setSets(a.sets);
      setProblem(a.problem && a.problem !== 'none' ? a.problem : null);
      setAsking(a.problem === null && (data.step || 1) <= 1);
    }).catch(() => setError("Couldn't start. Try again in a moment."));
  }, []);
  useEffect(() => { heading.current?.focus(); }, [step, finished, everything, asking, s === null]);

  if (!s) return <Shell title="A two-minute start" onClose={onClose}>{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-gray-500">One moment…</p>}</Shell>;

  const house = wants.includes('house');
  const order = house ? [1, 2, 3, 4] : [1, 2, 4];
  const place = order.indexOf(step) + 1;
  const total = order.length;
  const go = (to) => { setStep(to); setError(null); };

  const run = async (work) => {
    setBusy(true);
    setError(null);
    try { return await work(); } catch (err) { setError(errorMessage(err, "That didn't save. Try again.")); return undefined; } finally { setBusy(false); }
  };
  const lifeNow = async () => (await axios.get('/api/life')).data;

  /** Leave: tell the page its sections may have changed, and where to go. */
  const leave = async (to) => {
    const profile = await lifeNow().catch(() => null);
    if (fresh) { window.location.assign(to || '/'); return; }
    onDone(profile);
    // The front page is already open behind this: its Start here card and examples are new since it loaded.
    window.dispatchEvent(new Event(START_CHANGED));
    if (to) navigate(to);
  };
  const close = async () => {
    if (finished) { await leave(null); return; }
    await axios.post('/api/start/close', { step }).catch(() => {});
    if (fresh && touched.current) { window.location.reload(); return; }
    onClose();
  };

  const next = () => run(async () => {
    if (step === 1) {
      await axios.put('/api/start/people', { adults: names(adults), children: names(children), pets: pets.filter((p) => p.name.trim()) });
      go(2);
    } else if (step === 2) {
      const { data } = await axios.put('/api/start/interests', { wants, hobbies });
      go(data.step);
    } else if (step === 3) {
      await axios.put('/api/start/upkeep', { sets, has_car: hasCar });
      go(4);
    } else {
      await axios.put('/api/start/examples', { on: sample });
      const { data } = await axios.post('/api/start/finish', {});
      setFinished(data);
    }
    touched.current = true;
  });
  const back = () => go(order[Math.max(0, order.indexOf(step) - 1)]);

  const skip = () => run(async () => {
    await axios.put('/api/life', { areas: [] });
    await axios.post('/api/start/skip', {}).catch(() => {});
    if (fresh) { window.location.reload(); return; }
    onDone();
  });
  const setUpNow = () => run(async () => {
    await axios.post('/api/start/finish', { early: true });
    await leave(null);
  });

  const setCount = (n) => setPets((list) => Array.from({ length: n }, (_, i) => list[i] ?? { kind: 'dog', name: '' }));
  const setPet = (i, patch) => setPets((list) => list.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const toggle = (list, setList, key) => setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const chooseCar = (yes) => {
    setHasCar(yes);
    setSets((list) => (yes ? [...new Set([...list, 'car'])] : list.filter((k) => k !== 'car')));
  };

  const head = (words) => <h3 ref={heading} tabIndex={-1} className="text-base font-semibold text-life-800 outline-none dark:text-life-50">{words}</h3>;

  if (everything) {
    // The long checklist, for anyone who would rather tick it all themselves.
    return (
      <Shell title="A two-minute start" onClose={close}>
        <h3 ref={heading} tabIndex={-1} className="mb-2 text-base font-semibold text-life-800 outline-none dark:text-life-50">Choose everything yourself</h3>
        <p className="mb-3 text-sm text-gray-600 dark:text-life-100">Check everything that applies. Life Is sets itself up to match, and you can change it any time in Settings.</p>
        <LifeAreasPicker saveLabel="Set up Life Is"
          onSaved={(data) => { axios.post('/api/start/finish', { early: true }).catch(() => {}).finally(() => setTimeout(() => (fresh ? window.location.assign('/') : onDone(data)), data.added.length ? 1400 : 300)); }}
          onSkip={() => { axios.post('/api/start/skip', {}).catch(() => {}); if (fresh) window.location.reload(); else onDone(); }} />
        <div className="mt-3"><button type="button" onClick={() => setEverything(false)} className={quiet}>Back to the quick start</button></div>
      </Shell>
    );
  }

  /** What bugs them most: the parts it points to start checked, and Home opens on its card. */
  const answerProblem = () => run(async () => {
    await axios.put('/api/start/problem', { problem: problem ?? '' });
    const extra = s.options.problems.find((p) => p.key === problem)?.wants ?? [];
    setWants([...new Set([...FIRST, ...extra])]);
    setAsking(false);
    touched.current = true;
  });

  if (asking) {
    return (
      <Shell title="A two-minute start" onClose={close}>
        {head('What bugs you most at home?')}
        <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Pick one. Life Is starts there. Or press Next to skip this question.</p>
        <div role="radiogroup" aria-label="What bugs you most at home" className="mt-3 space-y-2">
          {s.options.problems.map((p) => (
            <label key={p.key} className={`${picked(problem === p.key)} items-center`}>
              <input type="radio" name="problem" checked={problem === p.key} onChange={() => setProblem(p.key)} className={tick} />
              <span className="text-gray-800 dark:text-life-50">{p.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-gray-500 dark:text-life-300">Most people need no server. Start on this phone or computer, and move to a server later with a backup file.</p>
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 space-y-2 border-t border-life-100 bg-card px-4 pb-4 pt-3 dark:border-life-700 dark:bg-life-800 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
          <div className="flex justify-end gap-2">
            <button type="button" onClick={answerProblem} disabled={busy} className={primary}>{busy ? 'Saving…' : 'Next'}</button>
          </div>
          <div className="flex flex-wrap justify-between gap-x-2">
            <button type="button" onClick={skip} disabled={busy} className="min-h-[44px] text-sm text-life-700 underline disabled:opacity-50 dark:text-life-200">Skip, show me everything</button>
            <button type="button" onClick={setUpNow} disabled={busy} className="min-h-[44px] text-sm text-life-700 underline disabled:opacity-50 dark:text-life-200">Set up Life Is now</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (finished) {
    const where = finished.landing ?? { to: '/', label: 'Go to the front page' };
    return (
      <Shell title="A two-minute start" onClose={close}>
        {head('You’re all set')}
        <p className="mt-2 text-sm text-gray-700 dark:text-life-100">{finished.summary}</p>
        <p className="mt-2 text-xs text-gray-500 dark:text-life-300">Weather and other outside services can be turned on in Settings. Nothing reaches outside Life Is until you do.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => leave(null)} className={quiet}>Stay on the front page</button>
          <button type="button" onClick={() => leave(where.to)} className={primary}>{where.label}</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="A two-minute start" onClose={close}>
      <p className="mb-1 text-sm font-medium text-life-600 dark:text-life-300" aria-live="polite" data-step={place}>Step {place} of {total}</p>

      {step === 1 && (
        <div className="space-y-3">
          {head('Who lives here?')}
          <p className="text-sm text-gray-600 dark:text-life-100">First names are enough, and all of it is optional.</p>
          <label className="block space-y-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-life-100">Adults</span>
            <input value={adults} onChange={(e) => setAdults(e.target.value)} placeholder="Sam, Alex" autoComplete="off" className={field} />
            <span className="block text-xs text-gray-500 dark:text-life-300">This only names them; it does not make sign-ins.</span>
          </label>
          <label className="block space-y-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-life-100">Children</span>
            <input value={children} onChange={(e) => setChildren(e.target.value)} placeholder="Hank, Loretta" autoComplete="off" className={field} />
            <span className="block text-xs text-gray-500 dark:text-life-300">They are added to the household, so chores can be given to them.</span>
          </label>
          <label className="block space-y-1">
            <span className="block text-sm font-medium text-gray-700 dark:text-life-100">How many pets?</span>
            <select value={pets.length} onChange={(e) => setCount(Number(e.target.value))} className={field}>
              {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {pets.map((p, i) => (
            <div key={i} className="grid grid-cols-[7rem_1fr] gap-2">
              <label className="block"><span className="sr-only">{`Pet ${i + 1} kind`}</span>
                <select value={p.kind} onChange={(e) => setPet(i, { kind: e.target.value })} className={field}>
                  <option value="dog">Dog</option><option value="cat">Cat</option><option value="other">Other</option>
                </select></label>
              <label className="block"><span className="sr-only">{`Pet ${i + 1} name`}</span>
                <input value={p.name} onChange={(e) => setPet(i, { name: e.target.value })} placeholder="Name" autoComplete="off" className={field} /></label>
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {head('What would you like help with?')}
          <p className="text-sm text-gray-600 dark:text-life-100">Life Is shows the parts you pick. Nothing is ever removed, and you can change this in Settings.</p>
          <div role="group" aria-label="What you would like help with" className="space-y-2">
            {s.options.wants.map((w) => (
              <div key={w.key} className="space-y-2">
                <label className={picked(wants.includes(w.key))}>
                  <input type="checkbox" checked={wants.includes(w.key)} onChange={() => toggle(wants, setWants, w.key)} className={tick} />
                  <span><span className="block font-medium text-gray-800 dark:text-life-50">{w.label}</span><span className="block text-xs text-gray-500 dark:text-life-300">{w.about}</span></span>
                </label>
                {w.key === 'projects' && wants.includes('projects') && (
                  <fieldset className="ml-3 space-y-1 border-l-2 border-life-100 pl-3 dark:border-life-700">
                    <legend className="text-xs font-medium text-gray-600 dark:text-life-200">What do you make or do?</legend>
                    {s.options.hobbies.map((h) => (
                      <label key={h.key} className={picked(hobbies.includes(h.key))}>
                        <input type="checkbox" checked={hobbies.includes(h.key)} onChange={() => toggle(hobbies, setHobbies, h.key)} className={tick} />
                        <span className="text-gray-800 dark:text-life-50">{h.label}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-life-300">Choose nothing and everything shows.</p>
          <button type="button" onClick={() => setEverything(true)} className="min-h-[44px] text-sm text-life-700 underline dark:text-life-200">Choose everything myself</button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          {head('Start with the usual upkeep?')}
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-gray-700 dark:text-life-100">Does anyone here have a car?</legend>
            <div className="flex gap-2">
              {[[true, 'Yes'], [false, 'No']].map(([v, word]) => (
                <label key={word} className={`${picked(hasCar === v)} items-center`}>
                  <input type="radio" name="has-car" checked={hasCar === v} onChange={() => chooseCar(v)} className={tick} /> {word}
                </label>
              ))}
            </div>
          </fieldset>
          <div role="group" aria-label="Sets of upkeep jobs" className="space-y-2">
            {s.options.sets.map((set) => (
              <label key={set.slug} className={picked(sets.includes(set.slug))}>
                <input type="checkbox" checked={sets.includes(set.slug)} onChange={() => toggle(sets, setSets, set.slug)} className={tick} />
                <span><span className="block font-medium text-gray-800 dark:text-life-50">{set.name} <span className="font-normal text-gray-500 dark:text-life-300">· {set.jobs} jobs</span></span>
                  <span className="block text-xs text-gray-500 dark:text-life-300">{set.about}</span></span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 dark:text-life-300">You can remove any job later.</p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          {head('A sample to look at?')}
          <label className={picked(sample)}>
            <input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} className={tick} />
            <span><span className="block font-medium text-gray-800 dark:text-life-50">Put a few examples in</span>
              <span className="block text-xs text-gray-500 dark:text-life-300">so the pages aren’t empty. They go in only the parts you picked, and each says Example. You can clear them all with one tap.</span></span>
          </label>
          <p className="text-xs text-gray-500 dark:text-life-300">Nothing is looked up for them. They are written out here.</p>
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 space-y-2 border-t border-life-100 bg-card px-4 pb-4 pt-3 dark:border-life-700 dark:bg-life-800 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6 sm:pb-6">
        <div className="flex justify-between gap-2">
          <button type="button" onClick={back} disabled={busy || step === 1} className={quiet}>Back</button>
          <button type="button" onClick={next} disabled={busy} className={primary}>{busy ? 'Saving…' : step === 4 ? 'Finish' : 'Next'}</button>
        </div>
        <div className="flex flex-wrap justify-between gap-x-2">
          <button type="button" onClick={skip} disabled={busy} className="min-h-[44px] text-sm text-life-700 underline disabled:opacity-50 dark:text-life-200">Skip, show me everything</button>
          {step < 4 && <button type="button" onClick={setUpNow} disabled={busy} className="min-h-[44px] text-sm text-life-700 underline disabled:opacity-50 dark:text-life-200">Set up Life Is now</button>}
        </div>
      </div>
    </Shell>
  );
}

/**
 * The small cards on the front page: "Finish setting up" for a start left part way, and "Start here" with three to
 * five small steps that tick themselves, and, while there are examples, a way to clear them.
 */
export function StartCard({ onChanged }) {
  const [s, setS] = useState(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = () => axios.get('/api/start').then(({ data }) => setS(data)).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => {
    window.addEventListener(START_CHANGED, load);
    return () => window.removeEventListener(START_CHANGED, load);
  }, []);
  const card = s?.card;
  if (!card && !open) return message ? <p role="status" className={`${cardClass} text-sm text-gray-700 dark:text-life-100`}>{message}</p> : null;

  const act = async (work) => { setBusy(true); try { await work(); } catch (err) { setMessage(errorMessage(err, "That didn't work. Try again.")); } finally { setBusy(false); } };
  const dismiss = () => act(async () => { setS((await axios.post('/api/start/dismiss', {})).data); });
  const clear = () => act(async () => {
    const { data } = await axios.post('/api/start/examples/clear', {});
    setMessage(data.message);
    setS(data.state);
    onChanged?.();
  });

  return (
    <>
      {card?.kind === 'finish' && (
        <section className={cardClass} aria-label="Finish setting up">
          <h2 className="font-semibold text-life-800 dark:text-life-50">Finish setting up</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-life-100">You left the two-minute start part way. What you did is kept.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => setOpen(true)} className={primary}>Pick up where you left off</button>
            <button type="button" onClick={dismiss} disabled={busy} className={quiet}>Not now</button>
          </div>
        </section>
      )}
      {card?.kind === 'started' && (
        <section className={cardClass} aria-label="Start here">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-semibold text-life-800 dark:text-life-50">Start here</h2>
            <button type="button" onClick={dismiss} disabled={busy} className="min-h-[44px] text-xs text-gray-500 underline dark:text-life-300">Hide this</button>
          </div>
          {card.steps.length > 0 && (
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
              {card.steps.map((t) => (
                <li key={t.key} data-step={t.key} data-done={t.done}>
                  <Link to={t.to} className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm hover:underline ${t.done ? 'bg-life-50/40 text-gray-500 dark:bg-life-700/30 dark:text-life-300' : 'bg-life-50/70 text-life-800 dark:bg-life-700/60 dark:text-life-50'}`}>
                    <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm ${t.done ? 'border-life-600 bg-life-600 text-white' : 'border-life-300 dark:border-life-500'}`}>{t.done ? '✓' : ''}</span>
                    <span className="flex-1"><span className="sr-only">{t.done ? 'Done: ' : 'To do: '}</span><span className={t.done ? 'line-through' : ''}>{t.label}</span></span>
                    <span className="shrink-0 text-xs text-gray-500 dark:text-life-300">{t.minutes} min</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {card.examples && (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-600 dark:text-life-100">
              <span className="mr-auto">Some pages hold examples, each marked Example.</span>
              <button type="button" onClick={clear} disabled={busy} className={quiet}>Clear the examples</button>
            </p>
          )}
          {message && <p role="status" className="mt-2 text-sm text-gray-700 dark:text-life-100">{message}</p>}
        </section>
      )}
      {open && <StartDialog fresh onClose={() => { setOpen(false); load(); }} onDone={() => { setOpen(false); load(); onChanged?.(); }} />}
    </>
  );
}

/**
 * The weekly question, on Home in the week it was sent: three things that are missing, or, once after the second
 * week, whether to keep asking. It only exists for someone who has chosen a way to be reminded.
 */
export function WeeklyCard() {
  const [w, setW] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { axios.get('/api/start/weekly').then(({ data }) => setW(data)).catch(() => {}); }, []);
  if (!w || !w.active) return null;
  const answer = async (what) => { setBusy(true); try { setW((await axios.post('/api/start/weekly', { answer: what })).data); } catch { /* try again */ } finally { setBusy(false); } };
  if (w.ask) {
    return (
      <section className={cardClass} aria-label="The weekly question">
        <h2 className="font-semibold text-life-800 dark:text-life-50">Keep the weekly question?</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-life-100">Each Monday it asks what you want to get done that week, in the same way as your other reminders.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => answer('keep')} disabled={busy} className={primary}>Keep weekly</button>
          <button type="button" onClick={() => answer('stop')} disabled={busy} className={quiet}>Stop</button>
        </div>
      </section>
    );
  }
  if (w.picks.length === 0) return null;
  return (
    <section className={cardClass} aria-label="The weekly question">
      <h2 className="font-semibold text-life-800 dark:text-life-50">What do you want to get done this week?</h2>
      <ul className="mt-1 grid gap-2 sm:grid-cols-3">
        {w.picks.map((p) => (
          <li key={p.key}><Link to={p.to} className="flex min-h-[44px] items-center rounded-lg bg-life-50/70 px-3 py-2 text-sm text-life-800 hover:underline dark:bg-life-700/60 dark:text-life-50">{p.label} →</Link></li>
        ))}
      </ul>
    </section>
  );
}
