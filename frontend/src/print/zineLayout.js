/**
 * The pocket zine: ONE letter sheet, one side, eight panels (4 across, 2 down), folded into eighths and cut once.
 *
 * The standard one-sheet zine ("mini-zine", "eight-page minibook") layout, seen on the printed side with the sheet
 * held landscape:
 *
 *        top row   (upside down)   5   4   3   2
 *        bottom row (upright)      6   7   8   1
 *
 * Why: the spreads of the little book sit side by side on the paper. The outside spread is 8 | 1 (back cover, cover),
 * and the inner spreads are 6 | 7, 4 | 5 and 2 | 3. The bottom row holds 6 7 8 1 as they read. The top row is the
 * same book turned half a turn, so reading its spreads upright gives 2 | 3 and 4 | 5, which on the paper, turned the
 * other way up, run 5 4 3 2 from the left. Folding the sheet in half top to bottom puts 2 on the back of 1, 3 behind
 * 8, 4 behind 7 and 5 behind 6. One cut along the middle fold, across the middle two columns, lets it open into a book.
 *
 * `page` is the page's place in the little book (1 is the cover, 8 the back cover); `turn` is how far the panel is
 * turned on the sheet.
 */
export const ZINE_LAYOUT = [
  [{ page: 5, turn: 180 }, { page: 4, turn: 180 }, { page: 3, turn: 180 }, { page: 2, turn: 180 }],
  [{ page: 6, turn: 0 }, { page: 7, turn: 0 }, { page: 8, turn: 0 }, { page: 1, turn: 0 }],
];

/** What each page of the little book holds, in reading order. */
export const ZINE_PAGES = ['cover', 'emergencies', 'contacts', 'wifi', 'pets', 'quirks', 'services', 'back'];

/** The panels in the order they sit on the sheet (the top row first, left to right), each with its content. */
export function zinePanels() {
  return ZINE_LAYOUT.flat().map(({ page, turn }) => ({ page, turn, content: ZINE_PAGES[page - 1] }));
}

/** The sheet's size and the panels' size, in inches, inside the 1/4 inch margin a home printer can keep. */
export const ZINE_SHEET = { width: 10.5, height: 8, columns: 4, rows: 2, panelWidth: 10.5 / 4, panelHeight: 4 };
