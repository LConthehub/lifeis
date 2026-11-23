import { useState } from 'react';
import CopyButton from './Copy';
import { groceryText, canNarrowToStore } from './groceryText';
import { buttonClass } from './ui';

/** Whether this device can hand text to its share sheet: the phone app's, or the browser's own (phones, some desktops). */
const onPhone = () => typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.());
export const canShareText = () => onPhone() || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');

/** A cancelled share is the person changing their mind, not a problem. */
const cancelled = (err) => err?.name === 'AbortError' || /cancel/i.test(String(err?.message ?? err));

const optionClass = 'flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-gray-800 dark:text-life-50';

/**
 * What goes in the "Share the list" sheet: the list as plain text, a few choices about it, and the two ways to send
 * it: the phone's share sheet where there is one, and copying. Life Is sends nothing itself.
 */
export default function ShareList({ items, lines, store, startGrouping }) {
  const canNarrow = canNarrowToStore(items, lines, store);
  const anyBought = items.some((g) => g.done);
  const [justHere, setJustHere] = useState(false);
  const [group, setGroup] = useState(startGrouping);
  const [includeBought, setIncludeBought] = useState(false);
  const [boxes, setBoxes] = useState(false);
  const [problem, setProblem] = useState('');
  const text = groceryText({ items, lines, store, group, justHere: canNarrow && justHere, includeBought: anyBought && includeBought, boxes });
  const empty = !items.some((g) => !g.done) && !(includeBought && anyBought);

  const share = async () => {
    setProblem('');
    try {
      if (onPhone()) {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: 'Groceries', text, dialogTitle: 'Share the list' });
      } else {
        await navigator.share({ title: 'Groceries', text });
      }
    } catch (err) {
      if (!cancelled(err)) setProblem("Couldn't open sharing. Copy works too.");
    }
  };
  const choice = (name, value, current, set, label) => (
    <label key={value} className={optionClass}>
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => set(value)} className="h-5 w-5 accent-life-600" />{label}
    </label>
  );

  return (
    <div className="min-w-0 space-y-3">
      <pre aria-label="The list as it will be sent" data-share-preview className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-life-50 p-3 font-sans text-sm text-gray-800 dark:bg-life-900 dark:text-life-50">{text}</pre>

      <fieldset className="space-y-0.5">
        <legend className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">What to send</legend>
        {choice('share-what', 'all', canNarrow && justHere ? 'here' : 'all', () => setJustHere(false), 'Everything still to get')}
        {canNarrow && choice('share-what', 'here', justHere ? 'here' : 'all', () => setJustHere(true), `Just ${store}`)}
      </fieldset>

      <fieldset className="space-y-0.5">
        <legend className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">How to group it</legend>
        {[['aisle', 'Grouped by aisle'], ['store', 'Grouped by store'], ['none', 'One plain list']].map(([value, label]) => choice('share-group', value, group, setGroup, label))}
      </fieldset>

      <div className="space-y-0.5">
        {anyBought && (
          <label className={optionClass}>
            <input type="checkbox" checked={includeBought} onChange={(e) => setIncludeBought(e.target.checked)} className="h-5 w-5 accent-life-600" />Include what is already in the buggy
          </label>
        )}
        <label className={optionClass}>
          <input type="checkbox" checked={boxes} onChange={(e) => setBoxes(e.target.checked)} className="h-5 w-5 accent-life-600" />With check boxes
        </label>
      </div>

      {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {canShareText() && <button type="button" onClick={share} disabled={empty} className={`${buttonClass} min-h-[44px]`}>Share…</button>}
        <CopyButton text={text} what="the list" />
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">This sends the list wherever you choose. Life Is sends nothing on its own.</p>
    </div>
  );
}
