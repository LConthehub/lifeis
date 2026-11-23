// Decorative pictures come through here (the list is in ../art.js). A slot with no file renders nothing at all:
// no broken picture, no empty box. Only decoration, so hidden from screen readers.
import { ART } from '../art';

export default function Art({ slot, className = '' }) {
  const file = ART[slot];
  if (!file) return null;
  return <img src={`/art/${file}`} alt="" aria-hidden="true" draggable="false" className={className} />;
}

/** The colored stripe under the header and at the top of the sign-in card. Until the owner's wave is added it is plain
 *  straight bands (plum, green, gold, orange, cream); once ART.wave names a file, that picture tiles across it. */
export function Stripe({ className = '' }) {
  if (ART.wave) {
    return <div aria-hidden="true" className={`h-4 bg-repeat-x ${className}`} style={{ backgroundImage: `url(/art/${ART.wave})`, backgroundSize: 'auto 100%' }} />;
  }
  return <div aria-hidden="true" className={`h-2.5 bg-life-all ${className}`} />;
}
