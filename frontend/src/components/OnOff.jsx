import { useEffect, useState } from 'react';
import axios from 'axios';

/**
 * The check box that starts every on/off card in Settings: "Turn on weather". Checked means the thing is on
 * (or, for a card that needs setup, that its setup is open). `why` greys the box with a short reason.
 */
export function OnOffBox({ label, checked, onChange, disabled = false, why = '', name }) {
  return (
    <div>
      <label className={`flex min-h-[44px] items-center gap-3 text-sm font-medium text-gray-800 dark:text-life-50 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
        <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 flex-none accent-life-600" />
        <span>{label}</span>
      </label>
      {disabled && why && <p className="text-xs text-gray-600 dark:text-life-200" data-why>{why}</p>}
    </div>
  );
}

/** The small link under an unchecked card that wipes what was kept. It asks first (`ask` left out: the action asks itself). */
export function ForgetIt({ onForget, ask, children = 'Forget it' }) {
  return (
    <button type="button" data-forget onClick={() => { if (!ask || window.confirm(ask)) onForget(); }} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">{children}</button>
  );
}

/**
 * Whether a connection (mail, calendars, photos, media) is switched off with its setup kept, and how to change that.
 * `paused` is null until it is known.
 */
export function usePaused(kind) {
  const [paused, setPausedNow] = useState(null);
  useEffect(() => { axios.get('/api/paused').then(({ data }) => setPausedNow(Boolean(data[kind]))).catch(() => setPausedNow(false)); }, [kind]);
  const set = async (value) => { const { data } = await axios.put('/api/paused', { what: kind, paused: value }); setPausedNow(Boolean(data[kind])); };
  return [paused, set];
}
