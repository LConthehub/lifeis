import { describe, expect, it } from 'vitest';
import { bookGenres, readProduct } from '../src/lookups.ts';

describe('reading what a shop calls a product', () => {
  it('finds the title and the format, and what kind of thing it is', () => {
    expect(readProduct('The Matrix [Blu-ray] (Widescreen)', 'Media > DVDs & Videos')).toEqual({ type: 'film', title: 'The Matrix', format: 'Blu-ray' });
    expect(readProduct('Jaws (4K Ultra HD + Blu-ray)', '')).toEqual({ type: 'film', title: 'Jaws', format: '4K Blu-ray' });
    expect(readProduct('The Legend of Zelda: Tears of the Kingdom - Nintendo Switch', 'Video Games')).toEqual({ type: 'game', title: 'The Legend of Zelda: Tears of the Kingdom', format: 'Switch' });
    expect(readProduct('Rumours [Vinyl LP]', 'Music')).toEqual({ type: 'music', title: 'Rumours', format: 'Vinyl' });
    expect(readProduct('La Blast 3 Dvd Dance Workout Collection Dvd', 'Electronics > Video > DVD & Blu-ray Players')).toEqual({ type: 'film', title: 'La Blast 3 Dvd Dance Workout Collection', format: 'DVD' });
    expect(readProduct('Stainless steel water bottle', 'Home & Garden')).toEqual({ type: 'other', title: 'Stainless steel water bottle', format: null });
  });
  it('keeps the name whole when it is all brackets', () => {
    expect(readProduct('[Untitled]', '').title).toBe('[Untitled]');
  });
});

describe("a library's subjects as genres", () => {
  it('keeps short, plain ones, without filing notes or repeats, five at most', () => {
    expect(bookGenres(['Science fiction', 'Fiction, general', 'nyt:hardcover-fiction=2020-01-01', 'Accessible book', 'science fiction', 'Protected DAISY', 'A very long subject heading that nobody would call a genre'])).toEqual(['Science fiction', 'Fiction']);
    expect(bookGenres(['a', 'b', 'c', 'd', 'e', 'f'])).toHaveLength(5);
    // What Open Library really sends for Dune.
    expect(bookGenres(['Dune (Imaginary place)', 'Fiction', 'Fiction, science fiction, general', 'New York Times reviewed', 'Science fiction', 'Science-fiction'])).toEqual(['Fiction', 'Science fiction']);
  });
});
