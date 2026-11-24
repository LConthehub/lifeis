import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

/** Keeps the screen on while this is open (Screen Wake Lock). Returns false where the browser has no such thing. */
function useScreenOn() {
  const [able] = useState(() => typeof navigator !== 'undefined' && !!navigator.wakeLock?.request);
  useEffect(() => {
    if (!able) return undefined;
    let lock = null;
    let gone = false;
    const hold = async () => {
      try {
        const got = await navigator.wakeLock.request('screen');
        if (gone) { got.release().catch(() => {}); return; }
        lock = got;
      } catch { /* refused (low battery, hidden page): the quiet line is not needed, the kitchen goes on */ }
    };
    // The browser lets go of the lock when the page is hidden; ask again when it is back.
    const back = () => { if (document.visibilityState === 'visible' && (!lock || lock.released)) hold(); };
    hold();
    document.addEventListener('visibilitychange', back);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', back);
      if (lock) lock.release().catch(() => {});
    };
  }, [able]);
  return able;
}

/**
 * A full-screen view of one recipe for the kitchen: big ingredients and steps, each with a large box to tick.
 * Ticks live only in this component, so they are gone when it closes. Nothing is saved.
 */
export default function CookingView({ recipe, servings, onDone }) {
  const [ticked, setTicked] = useState(() => new Set());
  const box = useRef(null);
  const able = useScreenOn();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDone(); };
    document.addEventListener('keydown', onKey);
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = was; };
  }, [onDone]);

  const toggle = (key, isStep) => {
    const on = !ticked.has(key);
    setTicked((before) => { const next = new Set(before); if (on) next.add(key); else next.delete(key); return next; });
    if (on && isStep) {
      // Bring the next step that is not done yet to the middle of the screen.
      const steps = recipe.steps.filter((s) => !s.is_heading);
      const at = steps.findIndex((s) => `s${s.id}` === key);
      const next = steps.slice(at + 1).find((s) => !ticked.has(`s${s.id}`));
      if (next) requestAnimationFrame(() => box.current?.querySelector(`[data-key="s${next.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    }
  };

  const row = (key, isStep, label, children) => {
    const done = ticked.has(key);
    return (
      <li key={key} data-key={key}>
        <button type="button" role="checkbox" aria-checked={done} onClick={() => toggle(key, isStep)}
          className={`flex min-h-[64px] w-full items-start gap-4 rounded-2xl px-3 py-3 text-left transition-opacity hover:bg-life-50 dark:hover:bg-life-700 ${done ? 'opacity-40' : ''}`}>
          <span aria-hidden="true" className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border-2 text-xl font-bold ${done ? 'border-life-600 bg-life-600 text-white' : 'border-life-400 text-transparent dark:border-life-300'}`}><Icon of="done" size={22} /></span>
          <span className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-xl leading-snug text-gray-900 dark:text-life-50 ${done ? 'line-through' : ''}`}>
            {children}
            <span className="sr-only">{label}</span>
          </span>
        </button>
      </li>
    );
  };

  let n = 0;
  // Drawn on the page itself, not inside the app, so the sticky header cannot cover it.
  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label={`Cooking ${recipe.title}`} data-cooking
      className="fixed inset-0 z-50 overflow-y-auto overflow-x-hidden bg-card text-gray-900 dark:bg-life-800 dark:text-life-50">
      <div className="mx-auto max-w-2xl space-y-6 px-4 pb-24 pt-4">
        <div className="flex items-start gap-3">
          <h1 className="mr-auto min-w-0 break-words text-2xl font-semibold text-life-800 dark:text-life-50">{recipe.title}</h1>
          <button type="button" onClick={onDone} className="min-h-[48px] shrink-0 rounded-full bg-gradient-to-br from-life-500 to-life-700 px-5 text-base font-semibold text-white shadow-md">Done cooking</button>
        </div>
        {!able && <p className="text-sm text-gray-600 dark:text-life-200" role="note">This screen may dim on its own; tap now and then to keep it on.</p>}
        <section aria-label="Ingredients">
          <h2 className="mb-1 text-lg font-semibold text-life-700 dark:text-life-200">
            Ingredients{servings ? <span className="ml-2 text-sm font-normal text-gray-600 dark:text-life-200">for {servings}</span> : null}
          </h2>
          <ul className="space-y-1">
            {recipe.ingredients.map((l) => (l.is_heading
              ? <li key={`h${l.id}`} className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{l.text}</li>
              : row(`i${l.id}`, false, '', <>{l.text}{l.scaled && <span className="ml-2 whitespace-nowrap rounded bg-honey-100 px-1.5 text-base text-honey-700">{l.scaled}</span>}</>)))}
          </ul>
        </section>
        <section aria-label="Method">
          <h2 className="mb-1 text-lg font-semibold text-life-700 dark:text-life-200">Method</h2>
          <ol className="space-y-1">
            {recipe.steps.map((s) => (s.is_heading
              ? <li key={`h${s.id}`} className="px-3 pt-3 text-sm font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{s.text}</li>
              : row(`s${s.id}`, true, '', <><span className="mr-2 font-semibold text-life-600 dark:text-life-300">{++n}.</span>{s.text}</>)))}
          </ol>
        </section>
        <div className="flex justify-center pt-2">
          <button type="button" onClick={onDone} className="min-h-[56px] rounded-full border-2 border-life-500 px-8 text-lg font-semibold text-life-700 dark:text-life-100">Done cooking</button>
        </div>
      </div>
    </div>
  , document.body);
}
