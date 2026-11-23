import axios from 'axios';

/**
 * What grocery a barcode is, from Open Food Facts, when the person has turned grocery look-ups on in Settings. The same two
 * calls the grocery page's scanner makes: it asks Life Is whether look-ups are on, and only then asks for the product.
 * With them off nothing is asked of anyone, and this gives null.
 */
export async function lookUpProduct(code) {
  const { data: can } = await axios.get('/api/lookups').catch(() => ({ data: {} }));
  if (!can.groceries) return null;
  return axios.get('/api/lookups/product', { params: { code } }).then(({ data }) => data.product).catch(() => null);
}

/** "30 oz" as an amount and a unit for a form; empty when it can't be told. */
export function sizeParts(size) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(size || '');
  return m ? { quantity: m[1], unit: m[2] || '' } : { quantity: '', unit: '' };
}
