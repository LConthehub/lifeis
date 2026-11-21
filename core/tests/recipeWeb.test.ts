/** A recipe read from a web page: the form recipe sites publish for search engines, and nothing guessed. */
import { expect, it } from 'vitest';
import type { Fetcher } from '../src/connections.ts';
import { recipeFromPage, recipeFromWeb } from '../src/recipeWeb.ts';

const page = (...blocks: unknown[]) => `<html><head><title>Best Soup | Blog</title>${blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('')}</head><body><p>Twelve paragraphs about my holiday.</p></body></html>`;
const SOUP = {
  '@type': 'Recipe', name: 'Leek &amp; Potato Soup', description: 'A <b>quiet</b> soup.', recipeYield: ['4', '4 servings'], prepTime: 'PT15M', cookTime: 'PT1H5M',
  recipeIngredient: ['3 leeks, sliced', '1&frac12; lb potatoes', '1 tbsp butter &#8211; salted'],
  recipeInstructions: [{ '@type': 'HowToStep', text: '<p>Melt the butter.</p>' }, { '@type': 'HowToSection', name: 'To finish', itemListElement: [{ '@type': 'HowToStep', text: 'Blend &amp; season.' }] }],
  keywords: 'soup, winter',
};
const problem = (status: number) => expect.objectContaining({ name: 'Problem', status });

it('reads the recipe a page publishes, wherever in the page it sits, as plain words', () => {
  const read = recipeFromPage(page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'Blog' }, { '@type': 'Article', name: 'Story' }, SOUP] }), 'https://blog.example/soup');
  expect(read).toMatchObject({
    title: 'Leek & Potato Soup', description: 'A quiet soup.', servings: 4, prep_minutes: 15, cook_minutes: 65, source_url: 'https://blog.example/soup',
    ingredients_text: '3 leeks, sliced\n1½ lb potatoes\n1 tbsp butter – salted', steps_text: 'Melt the butter.\n\n# To finish\n\nBlend & season.', tags: ['soup', 'winter'],
  });
  expect(read.original_text).toContain('recipeIngredient');
  // A list of things, a type given as a list, and a broken block before the good one.
  expect(recipeFromPage(page('{not json', [{ '@type': 'BreadcrumbList' }, { ...SOUP, '@type': ['Recipe', 'NewsArticle'] }]), 'https://x.example/').title).toBe('Leek & Potato Soup');
  expect(recipeFromPage(page({ '@type': 'WebPage', mainEntity: SOUP }), 'https://x.example/').servings).toBe(4);
});

it('refuses, in words, a page with no recipe published in it', () => {
  expect(() => recipeFromPage('<html><body><h1>Soup</h1><p>3 leeks</p></body></html>', 'https://x.example/')).toThrow(/Copy the recipe's text/);
  expect(() => recipeFromPage(page({ '@type': 'Article', name: 'Story' }), 'https://x.example/')).toThrow(/Copy the recipe's text/);
  expect(() => recipeFromPage(page({ '@type': 'Recipe', name: 'Empty' }), 'https://x.example/')).toThrow(/Copy the recipe's text/);
});

it('fetches only the address given, and says plainly when it cannot', async () => {
  const asked: [string, Record<string, string>][] = [];
  let served: string | number = page(SOUP);
  const fetcher: Fetcher = async (url, headers) => {
    asked.push([url, headers]);
    if (served === 'down') throw new Error('no route');
    return { status: typeof served === 'number' ? served : 200, type: 'text/html', json: async () => ({}), bytes: async () => new TextEncoder().encode(String(served)) };
  };
  expect((await recipeFromWeb(fetcher, ' blog.example/soup ')).source_url).toBe('https://blog.example/soup');
  expect(asked).toHaveLength(1);
  expect(asked[0]![0]).toBe('https://blog.example/soup');
  expect(Object.keys(asked[0]![1]).sort()).toEqual(['Accept', 'Accept-Language', 'User-Agent']); // nothing about the person goes with it

  for (const bad of ['', 'ftp://x.example/a', 'https://me:pw@x.example/a', 'javascript:alert(1)']) await expect(recipeFromWeb(fetcher, bad)).rejects.toEqual(problem(400));
  expect(asked).toHaveLength(1);
  served = 403;
  await expect(recipeFromWeb(fetcher, 'https://x.example/a')).rejects.toThrow(/wouldn't give the page/);
  served = 404;
  await expect(recipeFromWeb(fetcher, 'https://x.example/a')).rejects.toThrow(/no page at that address/);
  served = 'down';
  await expect(recipeFromWeb(fetcher, 'https://x.example/a')).rejects.toThrow(/Couldn't reach/);
  await expect(recipeFromWeb(undefined, 'https://x.example/a')).rejects.toThrow(/isn't set up to reach outside/);
});
