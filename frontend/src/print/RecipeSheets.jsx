import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ART } from '../art';
import Picture from '../components/Picture';
import { minutesText } from '../components/ui';
import PrintFrame from './PrintFrame';
import { usePrintStyle } from './printStyle';

const PHRASE = 'Life is cooking';
const ingredientText = (l) => `${l.text}${l.scaled ? ` (${l.scaled})` : ''}`;
const metaOf = (r, servings) => [
  (servings ?? r.servings) && `Serves ${servings ?? r.servings}`,
  r.prep_minutes != null && `prep ${minutesText(r.prep_minutes)}`,
  r.cook_minutes != null && `cook ${minutesText(r.cook_minutes)}`,
].filter(Boolean).join(' · ');

/** What a recipe says, as plain blocks of words: used for the card, which has to be cut into cards that fit. */
export function recipeBlocks(r) {
  const out = [];
  if (r.description) out.push({ kind: 'desc', text: r.description.trim() });
  const lines = r.ingredients ?? [];
  if (lines.length) out.push({ kind: 'h', text: 'Ingredients' });
  for (const l of lines) out.push(l.is_heading ? { kind: 'sub', text: l.text } : { kind: 'ing', text: ingredientText(l) });
  if ((r.steps ?? []).length) out.push({ kind: 'h', text: 'Method' });
  let n = 0;
  for (const s of r.steps ?? []) out.push(s.is_heading ? { kind: 'sub', text: s.text } : { kind: 'step', text: `${++n}. ${s.text}` });
  if (r.notes) { out.push({ kind: 'h', text: 'Notes' }); out.push({ kind: 'note', text: r.notes.trim() }); }
  return out;
}

/** A heading is kept with the line after it, so a card never ends on a heading alone. */
function unitsOf(blocks) {
  const units = [];
  for (let at = 0; at < blocks.length; at += 1) {
    const b = blocks[at];
    if ((b.kind === 'h' || b.kind === 'sub') && blocks[at + 1]) { units.push([b, blocks[at + 1]]); at += 1; } else units.push([b]);
  }
  return units;
}

/** A long block cut at a sentence (or, failing that, in the middle), so it can run on to the next card. */
function halves(block) {
  const cut = Math.max(block.text.lastIndexOf('. ', block.text.length / 2) + 1, 0) || block.text.indexOf(' ', block.text.length / 2);
  if (cut <= 0 || cut >= block.text.length - 1) return null;
  return [{ ...block, text: block.text.slice(0, cut).trim() }, { ...block, text: block.text.slice(cut).trim(), kind: block.kind === 'step' ? 'cont' : block.kind }];
}

const CLASS = { desc: 'rc-desc', h: 'rc-h', sub: 'rc-sub', ing: 'rc-ing', step: 'rc-step', cont: 'rc-step rc-cont', note: 'rc-note' };

/**
 * Cut a recipe into cards. Each card is built for real in a hidden copy of the card (same size, same type) and a block goes
 * on a card only while its words still fit, so what is measured is what prints. The words flow in two columns, so the
 * ingredients usually sit beside the method. A card that is full is followed by another, "continued".
 */
export function packCards(r, servings, host) {
  const make = (first) => {
    const card = document.createElement('div');
    card.className = 'rc-card';
    const head = document.createElement('div');
    head.className = first ? 'rc-head' : 'rc-head rc-head-more';
    const title = document.createElement('p');
    title.className = first ? 'rc-title font-display' : 'rc-title-more';
    title.textContent = first ? r.title : `${r.title} (continued)`;
    head.append(title);
    if (first) { const meta = document.createElement('p'); meta.className = 'rc-meta'; meta.textContent = metaOf(r, servings) || ' '; head.append(meta); }
    const body = document.createElement('div');
    body.className = 'rc-body';
    card.append(head, body);
    host.append(card);
    return { card, body, first };
  };
  const add = (body, block) => { const p = document.createElement('p'); p.className = CLASS[block.kind]; p.textContent = block.text; body.append(p); return p; };
  const overflows = (body) => body.scrollWidth > body.clientWidth + 2 || body.scrollHeight > body.clientHeight + 2;

  const cards = [];
  let units = unitsOf(recipeBlocks(r));
  let at = 0;
  let cur = make(true);
  let blocks = [];
  while (at < units.length) {
    const unit = units[at];
    const added = unit.map((b) => add(cur.body, b));
    if (!overflows(cur.body)) { blocks.push(...unit); at += 1; continue; }
    added.forEach((p) => p.remove());
    if (blocks.length === 0) {
      // Nothing else is on this card and it still does not fit: cut the words, or (a last resort) let it be clipped.
      const split = unit.length === 1 ? halves(unit[0]) : null;
      if (split) { units = [...units.slice(0, at), [split[0]], [split[1]], ...units.slice(at + 1)]; continue; }
      if (unit.length > 1) { units = [...units.slice(0, at), [unit[0]], [unit[1]], ...units.slice(at + 1)]; continue; }
      blocks.push(...unit); at += 1;
    }
    cards.push({ first: cur.first, blocks });
    cur.card.remove();
    cur = make(false);
    blocks = [];
  }
  if (blocks.length || cards.length === 0) cards.push({ first: cur.first, blocks });
  cur.card.remove();
  return cards;
}

/** One 4 x 6 inch card: a thin line border inset 1/4 in (or the owner's frame), the words kept inside the middle area. */
function Card({ card, r, servings }) {
  return (
    <div className="rc-card" data-card>
      <div className="pf-card-frame" aria-hidden="true">{ART.cardFrame && <img src={`/art/${ART.cardFrame}`} alt="" draggable="false" />}</div>
      <div className={card.first ? 'rc-head' : 'rc-head rc-head-more'}>
        {card.first ? <p className="rc-title font-display">{r.title}</p> : <p className="rc-title-more">{r.title} (continued)</p>}
        {card.first && <p className="rc-meta">{metaOf(r, servings) || ' '}</p>}
      </div>
      <div className="rc-body">
        {card.blocks.map((b, i) => <p key={i} className={CLASS[b.kind]}>{b.text}</p>)}
      </div>
    </div>
  );
}

/** Recipe cards, two to a letter sheet with dashed cut lines. */
function RecipeCards({ r, servings, cards }) {
  const [style] = usePrintStyle();
  const sheets = [];
  (cards ?? []).forEach((c, i) => { if (i % 2 === 0) sheets.push([]); sheets[sheets.length - 1].push(c); });
  return (
    <section className="pf rc" data-print-style={style} data-sheet="card" aria-label="Recipe cards">
      <style>{'@page { size: letter; margin: 0.5in; }'}</style>
      {sheets.map((pair, i) => (
        <div key={i} className="rc-page" data-card-page>
          {pair.map((c, j) => <Card key={j} card={c} r={r} servings={servings} />)}
        </div>
      ))}
    </section>
  );
}

/** The recipe on a letter page: the title, the picture, the ingredients in a column beside the steps, then the notes. */
function RecipePageSheet({ r, servings, photo }) {
  let n = 0;
  return (
    <PrintFrame phrase={PHRASE} title={r.title} sub={metaOf(r, servings)} framed className="pr" data-sheet="page" aria-label="The recipe page">
      <style>{'@page { size: letter; margin: 0.6in; }'}</style>
      {r.description && <p className="pr-desc">{r.description}</p>}
      {photo && <Picture src={photo} alt={r.title} className="pr-photo" />}
      <div className="pr-cols">
        <div className="pr-ing">
          <h3 className="font-display">Ingredients</h3>
          <ul>
            {r.ingredients.map((l) => (l.is_heading ? <li key={l.id} className="pr-sub">{l.text}</li> : <li key={l.id}>{ingredientText(l)}</li>))}
          </ul>
          {r.equipment?.length > 0 && (
            <>
              <h3 className="font-display">Cooked in</h3>
              <ul>{r.equipment.map((e) => <li key={e.id}>{e.quantity !== 1 ? `${e.quantity} × ` : ''}{e.label}</li>)}</ul>
            </>
          )}
        </div>
        <div className="pr-steps">
          <h3 className="font-display">Method</h3>
          <ol>
            {r.steps.map((s) => (s.is_heading ? <li key={s.id} className="pr-sub">{s.text}</li> : <li key={s.id}><span className="pr-n">{++n}</span><span>{s.text}</span></li>))}
          </ol>
        </div>
      </div>
      {r.notes && <div className="pr-notes"><h3 className="font-display">Notes</h3><p>{r.notes}</p></div>}
      {r.source_url && <p className="pr-source">From {String(r.source_url).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}</p>}
    </PrintFrame>
  );
}

/**
 * The recipe on paper in the way chosen: 'page' (letter) or 'card' (4 x 6 inch cards). Only on paper. The cards are cut up
 * as soon as the recipe is here (in a copy that is out of sight), so they are ready when Print is pressed.
 */
export default function RecipeSheets({ way, recipe, servings, photo }) {
  const host = useRef(null);
  const [cards, setCards] = useState(null);
  useEffect(() => {
    let live = true;
    // The fonts are measured, so wait until they are in.
    (document.fonts?.ready ?? Promise.resolve()).then(() => { if (live && host.current) setCards(packCards(recipe, servings, host.current)); });
    return () => { live = false; };
  }, [recipe, servings]);
  // Out of <main>, so the screen's page holds only its own pictures; the sheets are shown only on paper.
  return createPortal(
    <>
      <div ref={host} className="rc-measure print:hidden" aria-hidden="true" />
      <div className="recipe-print hidden print:block" data-way={way}>
        {way === 'card' ? <RecipeCards r={recipe} servings={servings} cards={cards} /> : <RecipePageSheet r={recipe} servings={servings} photo={photo} />}
      </div>
    </>,
    document.getElementById('print-root') ?? document.body,
  );
}
