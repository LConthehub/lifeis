import { useState } from 'react';
import { ART } from '../art';
import { PRINT_STYLES, usePrintStyle } from './printStyle';
import { buttonClass, inputClass, quietButtonClass } from '../components/ui';

/** The five bands of the stripe, in the artwork's order, until the owner's stripe.svg is added (frontend/src/art.js). */
export const STRIPE_BANDS = ['#60304f', '#3a742f', '#f2ce47', '#e7602c', '#f5e8cd'];

/** The stripe band, 3/8 in tall. Hidden (but still taking its room) in the plain styles, so the layout never moves. */
export function PrintStripe() {
  if (ART.stripe) return <div aria-hidden="true" className="pf-bands pf-art pf-bands-art" style={{ backgroundImage: `url(/art/${ART.stripe})` }} />;
  return <div aria-hidden="true" className="pf-bands pf-art">{STRIPE_BANDS.map((c) => <i key={c} style={{ background: c }} />)}</div>;
}

/** The mushroom on its heart. The owner's mushroom.svg once it is added; until then the one the app already uses. */
export function PrintMushroom({ size = '0.5in', className = '' }) {
  return <img src={ART.mushroom ? `/art/${ART.mushroom}` : '/mark-tan-192.png'} alt="" aria-hidden="true" draggable="false" className={`pf-mark pf-art ${className}`} style={{ width: size, height: size }} />;
}

/**
 * The top of every printout: the stripe band, then the little mushroom with the section's phrase ("Life is tasty"),
 * then the page's title in Fraunces. Everything but the words is left out (the room kept) in the plain print styles.
 */
export function PrintHead({ phrase, title, sub, framed = false, as: Title = 'h2' }) {
  return (
    <div className="pf-head" data-pf-head>
      <PrintStripe />
      <div className="pf-brand">
        <PrintMushroom />
        <span className="pf-phrase font-display">{phrase}</span>
      </div>
      {framed
        ? <div className="pf-titlebox" style={ART.cardFrame ? { backgroundImage: `url(/art/${ART.cardFrame})` } : undefined}><Title className="pf-title font-display">{title}</Title></div>
        : <Title className="pf-title font-display">{title}</Title>}
      {sub && <p className="pf-sub">{sub}</p>}
    </div>
  );
}

/**
 * The one frame every printout is made in: white paper, color as accents (see index.css, ".pf"). The print style the
 * person picked (printStyle.js) is on the element, and the styles change only colors and art, never the layout.
 * `phrase` is the section's own line ("Life is tidy"). Put what the page says after `title` in the children.
 */
export default function PrintFrame({ phrase, title, sub, as = 'section', headingAs, framed = false, className = '', children, ...rest }) {
  const [style] = usePrintStyle();
  const Tag = as;
  return (
    <Tag {...rest} className={`pf ${className}`} data-print-style={style}>
      <PrintHead phrase={phrase} title={title} sub={sub} framed={framed} as={headingAs} />
      {children}
    </Tag>
  );
}

/** A printout with no head of its own (a sheet of stickers): it takes the print style's colors and nothing else, so the labels keep their size. */
export function PrintInk({ as: Tag = 'div', className = '', children, ...rest }) {
  const [style] = usePrintStyle();
  return <Tag {...rest} className={`pf ${className}`} data-print-style={style}>{children}</Tag>;
}

/** "Print style": the look every printout on this device takes, remembered here. Only on screen, never on paper. */
export function PrintStyleChoice({ className = '' }) {
  const [style, setStyle] = usePrintStyle();
  return (
    <label className={`flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-life-100 print:hidden ${className}`}>
      Print style
      <select value={style} onChange={(e) => setStyle(e.target.value)} className={`${inputClass} !w-auto min-h-[44px]`}>
        {PRINT_STYLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>
  );
}

/**
 * A Print button that opens the ways to print: the print style, then one button for each way. `ways` is a list of
 * [id, label]; `onPrint(id)` makes that sheet and prints it. Only on screen.
 */
export function PrintMenu({ ways, onPrint, disabled = false, label = 'Print', children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="print:hidden">
      <button type="button" disabled={disabled} aria-expanded={open} onClick={() => setOpen(!open)} className={`${quietButtonClass} min-h-[44px]`}>{label}</button>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-life-200 p-3 dark:border-life-700" role="group" aria-label="How to print">
          <PrintStyleChoice />
          {children}
          <div className="flex flex-wrap gap-2">
            {ways.map(([id, text]) => <button key={id} type="button" onClick={() => onPrint(id)} className={`${buttonClass} min-h-[44px]`}>{text}</button>)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Show the sheet for `id` (the sheets are only on paper), then open the browser's print box. */
export function printSoon(setWay, id) {
  setWay(id);
  setTimeout(() => window.print(), 60);
}
