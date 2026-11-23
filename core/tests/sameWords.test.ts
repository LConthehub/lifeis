import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { piecesWord } from '../src/media.ts';

// Pages cannot import from core, so the Media page keeps its own copy of piecesWord. This test reads that copy
// out of the page's source and checks both copies give the same answer, so changing one and not the other fails.
const page = readFileSync(fileURLToPath(new URL('../../frontend/src/pages/Media.jsx', import.meta.url)), 'utf8');
const match = /^(?:export )?function piecesWord\(format\) \{[\s\S]*?^\}/m.exec(page);

describe('piecesWord, in core and in the Media page', () => {
  it('finds the page copy in its source', () => {
    expect(match, 'function piecesWord is not in Media.jsx').not.toBeNull();
  });

  const pageCopy = new Function(`${match![0].replace(/^export /, '')}\nreturn piecesWord;`)() as (format: string | null) => { one: string; many: string; known: boolean };

  const formats = [
    'CD', 'Book on CD', 'Audio CD', 'DVD', 'Blu-ray', '4K UHD', 'LaserDisc', 'Disc', 'Disk', 'Cassette',
    'Book on tape', 'VHS', 'Betamax', '8-track', 'Vinyl', 'LP', 'Record', 'Hardcover', 'Paperback', 'Digital',
    'Cartridge', 'MiniDisc', 'Kindle', 'eBook', 'Audiobook', 'Board game',
    // Odd capitalizations and spellings.
    'cd', 'BLU-RAY', 'bluray', 'blu ray', 'vhs', 'VinYL', 'Vinyl LP', '8 Track', 'audio cassette', 'DISCS', '',
  ];

  it('gives the same word for every format name in both copies', () => {
    for (const format of formats) {
      expect(pageCopy(format), `page copy for "${format}"`).toEqual(piecesWord(format));
    }
    expect(pageCopy(null)).toEqual(piecesWord(null));
  });

  it('still says what the common formats are, so the comparison is not empty', () => {
    expect(piecesWord('CD').many).toBe('discs');
    expect(pageCopy('CD').many).toBe('discs');
    expect(piecesWord('Cassette').many).toBe('tapes');
    expect(pageCopy('Cassette').many).toBe('tapes');
    expect(piecesWord('Vinyl').many).toBe('records');
    expect(pageCopy('Vinyl').many).toBe('records');
    expect(piecesWord('Kindle').known).toBe(false);
    expect(pageCopy('Kindle').known).toBe(false);
  });
});
