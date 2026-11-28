import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { buttonClass, errorMessage, quietButtonClass, toDateInput } from './ui';

const FIVE_MINUTES = 300;
const keyOf = (kind, id) => `lifeis.firstStep.${kind}.${id}`;

/** How many of a chore's written steps were gone through today, kept on this device only (a chore keeps no check for each line). */
const gone = (kind, id) => {
  try {
    const saved = JSON.parse(window.localStorage.getItem(keyOf(kind, id)) || 'null');
    return saved && saved.day === toDateInput(new Date()) ? Number(saved.n) || 0 : 0;
  } catch { return 0; }
};
const keepGone = (kind, id, n) => {
  try {
    if (n > 0) window.localStorage.setItem(keyOf(kind, id), JSON.stringify({ day: toDateInput(new Date()), n }));
    else window.localStorage.removeItem(keyOf(kind, id));
  } catch { /* it lasts until this page closes */ }
};

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** The quiet view: one step in large type, a five-minute timer the person starts, Done, and "That's enough for today". */
function Quiet({ kind, id, onClose, onChanged }) {
  const [view, setView] = useState(null);          // the step as the server gave it
  const [shown, setShown] = useState(null);        // a smaller step chosen from the assistant's three, or null
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(null);          // seconds left on a running timer, or null when none runs
  const [helper, setHelper] = useState(false);
  const [offer, setOffer] = useState(null);        // { steps, sent } from "Break it down for me"
  const [asking, setAsking] = useState(false);
  const closeRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`/api/first-step/${kind}/${id}`, { params: { after: gone(kind, id) } });
      setView(data);
    } catch (err) { setError(errorMessage(err, "Couldn't find the step")); setView(false); }
  }, [kind, id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { axios.get('/api/assistant').then(({ data }) => setHelper(Boolean(data?.enabled))).catch(() => {}); }, []);
  useEffect(() => { closeRef.current?.focus(); }, [view]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = was; };
  }, [onClose]);
  useEffect(() => {
    if (left === null || left <= 0) return undefined;
    const t = setTimeout(() => setLeft((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [left]);

  const done = async () => {
    if (!view?.done) return;
    setBusy(true); setError('');
    try {
      const d = view.done;
      if (shown) {
        // A smaller step is only a way in: the real step stays as it was.
        setShown(null); setOffer(null); setLeft(null);
        setMessage('Good. That is a start.');
        return;
      }
      if (d.how === 'chore') await axios.post(`/api/things/upkeep/${d.id}/done`, {});
      else if (d.how === 'chore-line') {
        if (d.last) { await axios.post(`/api/things/upkeep/${d.id}/done`, {}); keepGone(kind, id, 0); } else keepGone(kind, id, gone(kind, id) + 1);
      } else if (d.how === 'line') await axios.post(`/api/projects/lines/${d.id}/use`);
      else if (d.how === 'routine') await axios.put(`/api/routine-day/steps/${d.id}`, { done: true });
      setLeft(null); setOffer(null); setMessage('Checked off.');
      onChanged?.();
      await load();
    } catch (err) { setError(errorMessage(err, "Couldn't save that")); } finally { setBusy(false); }
  };

  const breakDown = async () => {
    setAsking(true); setError(''); setOffer(null);
    try { setOffer((await axios.post('/api/first-step/break-down', { step: view.step, part: view.name })).data); }
    catch (err) { setError(errorMessage(err, "The assistant couldn't help just now. Nothing was changed.")); } finally { setAsking(false); }
  };

  const words = shown ?? view?.step;
  const big = 'text-2xl font-semibold leading-snug text-life-800 dark:text-life-50 [overflow-wrap:anywhere] sm:text-3xl';
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto bg-cream dark:bg-life-900" role="dialog" aria-modal="true" aria-label="Just the first step" data-first-step>
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col gap-5 p-4 sm:p-8">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 break-words text-sm text-gray-600 dark:text-life-200">{view ? view.name : ''}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-xl leading-none text-gray-500 hover:bg-life-50 dark:hover:bg-life-700">×</button>
        </div>

        {view === null && <p className="text-sm text-gray-600 dark:text-life-200">One moment.</p>}
        {view === false && <p className="text-sm text-red-600" role="alert">{error}</p>}

        {view && (
          <div className="flex flex-1 flex-col justify-center gap-5">
            {words ? (
              <>
                <div className="space-y-2">
                  {view.place && !shown && <p className="text-sm text-gray-600 dark:text-life-200" data-first-place>{view.place}</p>}
                  {shown && <p className="text-sm text-gray-600 dark:text-life-200">A smaller way in</p>}
                  <p className={big} data-first-words>{words}</p>
                  {!shown && view.more && <p className="text-sm text-gray-600 dark:text-life-200">{view.more}</p>}
                </div>

                <div className="rounded-xl border border-life-200 p-3 dark:border-life-700" data-first-timer>
                  {left === null ? (
                    <button type="button" onClick={() => setLeft(FIVE_MINUTES)} className={`${quietButtonClass} min-h-[44px]`}>Start 5 minutes</button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-2xl font-semibold tabular-nums text-life-800 dark:text-life-50" role="timer" aria-label={left > 0 ? `${clock(left)} left` : 'Time is up'}>{clock(left)}</span>
                      {left === 0 && <span className="text-sm text-gray-700 dark:text-life-100">Time is up. Stop, or keep going if it is going well.</span>}
                      <button type="button" onClick={() => setLeft(null)} className={`${quietButtonClass} min-h-[44px]`}>{left > 0 ? 'Stop the timer' : 'Clear'}</button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button type="button" disabled={busy} onClick={done} className={`${buttonClass} min-h-[44px] flex-1`}>Done</button>
                  <button type="button" onClick={onClose} className={`${quietButtonClass} min-h-[44px] flex-1`}>That's enough for today</button>
                </div>

                {helper && !shown && (
                  <div className="space-y-2">
                    <button type="button" disabled={asking} onClick={breakDown} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline disabled:opacity-50 dark:text-life-200">{asking ? 'Asking…' : 'Break it down for me'}</button>
                    {!offer && <p className="text-xs text-gray-500 dark:text-life-300">Sends the words of this step{view.name && view.name !== view.step ? ' and the name above it' : ''} to your assistant, and nothing else.</p>}
                  </div>
                )}
                {offer && (
                  <div className="space-y-2" data-first-offer>
                    <p className="text-sm text-gray-700 dark:text-life-100">Pick one to start with:</p>
                    <ul className="space-y-2">
                      {offer.steps.map((s) => (
                        <li key={s}><button type="button" onClick={() => { setShown(s); setOffer(null); setLeft(null); }} className={`${quietButtonClass} min-h-[44px] w-full text-left`}>{s}</button></li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-3">
                <p className={big} data-first-words>{message || 'Nothing is left for now.'}</p>
                {message && <p className="text-sm text-gray-600 dark:text-life-200">That was the last one.</p>}
                <button type="button" onClick={onClose} className={`${buttonClass} min-h-[44px]`}>Close</button>
              </div>
            )}
            {words && message && <p className="text-sm text-life-700 dark:text-life-100" role="status">{message}</p>}
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * "Just the first step": a button that opens a quiet view with the one next small step of a chore, a project or a
 * routine. `kind` is 'chore', 'project' or 'routine'. `onChanged` is called after a step is checked off.
 */
export default function FirstStep({ kind, id, onChanged, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-first-step-button className={`${quietButtonClass} min-h-[44px] ${className}`}>Just the first step</button>
      {open && <Quiet kind={kind} id={id} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}
