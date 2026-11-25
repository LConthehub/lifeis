import { describe, expect, it } from 'vitest';
// @ts-expect-error: a page file written in plain JavaScript
import { ZINE_LAYOUT, ZINE_PAGES, ZINE_SHEET, zinePanels } from '../../frontend/src/print/zineLayout.js';

type Panel = { page: number; turn: number };
const rows: Panel[][] = ZINE_LAYOUT;

/** Fold the sheet the way a person does and read the little book: the panels that are paper-neighbors across a fold. */
describe('the pocket zine layout (one sheet, folded into eighths, cut once)', () => {
  it('is the standard one-sheet order: 5 4 3 2 upside down over 6 7 8 1', () => {
    expect(rows.map((r) => r.map((p) => p.page))).toEqual([[5, 4, 3, 2], [6, 7, 8, 1]]);
    expect(rows[0]!.every((p) => p.turn === 180)).toBe(true);
    expect(rows[1]!.every((p) => p.turn === 0)).toBe(true);
  });

  it('has each page of the book once', () => {
    expect(rows.flat().map((p) => p.page).sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reads as the right spreads: 8 | 1 outside, then 2 | 3, 4 | 5 and 6 | 7 inside', () => {
    const spreads: string[] = [];
    rows.forEach((row) => {
      for (const at of [0, 2]) {
        const pair = [row[at]!, row[at + 1]!];
        // A row that is turned half a turn reads right to left.
        const left = (row[0]!.turn === 180 ? pair[1] : pair[0])!;
        const right = (row[0]!.turn === 180 ? pair[0] : pair[1])!;
        spreads.push(`${left.page}|${right.page}`);
      }
    });
    expect(spreads.sort()).toEqual(['2|3', '4|5', '6|7', '8|1'].sort());
    // Every spread opens on an even page and ends on the next odd one, and the back cover meets the cover.
    for (const s of spreads) { const [l, r] = s.split('|').map(Number) as [number, number]; expect(r).toBe(l === 8 ? 1 : l + 1); expect(l % 2).toBe(0); }
  });

  it('puts the back of each leaf behind its front when the sheet is folded top to bottom', () => {
    // Folding the top row down onto the bottom row, the panel in the same column ends up behind: 5/6 are one leaf, 3 sits behind 8, and so on.
    const behind = rows[0]!.map((top, at) => [top.page, rows[1]![at]!.page]);
    expect(behind).toEqual([[5, 6], [4, 7], [3, 8], [2, 1]]);
    // The leaves of the book: (1,2) and (5,6) are two sides of a leaf, so they meet across the fold. (3,4) and (7,8) are cut apart.
    const meets = behind.filter(([a, b]) => Math.abs(a! - b!) === 1 && Math.min(a!, b!) % 2 === 1).map(([a, b]) => [a, b].sort().join(''));
    expect(meets.sort()).toEqual(['12', '56']);
  });

  it('lays out the content in the order cover, emergencies, contacts, Wi-Fi, pets, quirks, services, back cover', () => {
    expect(ZINE_PAGES).toEqual(['cover', 'emergencies', 'contacts', 'wifi', 'pets', 'quirks', 'services', 'back']);
    const onSheet = zinePanels().map((p: { content: string }) => p.content);
    expect(onSheet).toEqual(['pets', 'wifi', 'contacts', 'emergencies', 'quirks', 'services', 'back', 'cover']);
  });

  it('fits a letter sheet held sideways, inside a quarter inch margin', () => {
    expect(ZINE_SHEET.width + 0.5).toBe(11);
    expect(ZINE_SHEET.height + 0.5).toBe(8.5);
    expect(ZINE_SHEET.panelWidth * ZINE_SHEET.columns).toBe(ZINE_SHEET.width);
    expect(ZINE_SHEET.panelHeight * ZINE_SHEET.rows).toBe(ZINE_SHEET.height);
  });
});
