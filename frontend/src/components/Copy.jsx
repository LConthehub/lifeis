import { useEffect, useRef, useState } from 'react';
import { quietButtonClass } from './ui';

/**
 * A button that copies `text` exactly as given. It says "Copied" for two seconds. Where the browser refuses
 * (an address that is not https, an old browser), it selects the text in `selectRef` (or the nearest text
 * field) and says "Press Ctrl+C to copy" instead, so the person can finish by hand.
 * `what` completes the accessible name: "Copy the calendar link".
 */
export default function CopyButton({ text, what = 'this', label = 'Copy', selectRef = null, className = quietButtonClass }) {
  const [state, setState] = useState('idle'); // idle | copied | manual
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const settle = (next) => { setState(next); clearTimeout(timer.current); timer.current = setTimeout(() => setState('idle'), next === 'manual' ? 5000 : 2000); };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      settle('copied');
    } catch {
      const el = selectRef?.current;
      if (el && el.select) el.select();
      else if (el) { const range = document.createRange(); range.selectNodeContents(el); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range); }
      settle('manual');
    }
  };
  return (
    <>
      <button type="button" onClick={copy} aria-label={`Copy ${what}`} className={`${className} min-h-[44px] shrink-0`}>{state === 'copied' ? 'Copied' : label}</button>
      <span role="status" aria-live="polite" className={state === 'manual' ? 'text-xs text-gray-600 dark:text-life-200' : 'sr-only'}>
        {state === 'copied' ? 'Copied' : state === 'manual' ? 'Press Ctrl+C to copy' : ''}
      </span>
    </>
  );
}

/** Something to copy, shown in monospace beside its button: an address, a command, a code. Wraps on a narrow phone. */
export function CopyLine({ text, what = 'this' }) {
  const ref = useRef(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code ref={ref} className="min-w-0 flex-1 select-all break-all rounded bg-life-50 px-2 py-1.5 font-mono text-xs text-gray-800 dark:bg-life-900 dark:text-life-50">{text}</code>
      <CopyButton text={text} what={what} selectRef={ref} />
    </div>
  );
}
