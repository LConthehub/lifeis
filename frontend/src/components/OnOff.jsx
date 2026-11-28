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

/** The small link under an unchecked card that wipes what was kept. It always asks first. */
export function ForgetIt({ onForget, ask, children = 'Forget it' }) {
  return (
    <button type="button" data-forget onClick={() => { if (window.confirm(ask)) onForget(); }} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">{children}</button>
  );
}
