import { useSyncExternalStore } from 'react';

/**
 * The print style a person picked, kept on this device (the page's other small choices, like the theme, are kept this
 * way too: Life Is has no per-person settings on the server). The same choice holds for every printout.
 *   life       the Life Is look: white paper, the stripe band, the mushroom, chocolate headings, gold and orange touches
 *   chocolate  no art, no stripe, no color fills: text and lines in chocolate
 *   black      the same, in black
 * The layout is the same in all three.
 */
export const PRINT_STYLES = [['life', 'Life Is look'], ['chocolate', 'Plain chocolate'], ['black', 'Plain black']];
export const PRINT_STYLE_KEY = 'lifeis.printStyle';

const valid = (value) => PRINT_STYLES.some(([id]) => id === value);
const read = () => { try { const v = window.localStorage.getItem(PRINT_STYLE_KEY); return valid(v) ? v : 'life'; } catch { return 'life'; } };

let current = read();
const listeners = new Set();
const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** Change the style for every printout on this device. */
export function setPrintStyle(value) {
  if (!valid(value)) return;
  current = value;
  try { window.localStorage.setItem(PRINT_STYLE_KEY, value); } catch { /* it lasts until this page closes */ }
  listeners.forEach((fn) => fn());
}

/** [style, setStyle]: the picked print style, shared by every part of the page that shows it. */
export function usePrintStyle() {
  const style = useSyncExternalStore(subscribe, () => current, () => 'life');
  return [style, setPrintStyle];
}
