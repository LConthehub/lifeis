import { useCallback, useState } from 'react';
import axios from 'axios';
import Scanner from './Scanner';
import { lookUpProduct, sizeParts } from './productLookup';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

/**
 * Scan things as they come home and put them in the pantry, one after another. A barcode Life Is knows (from the grocery
 * list's scanner) adds to that pantry item; a new one is named once and remembered. Asking Open Food Facts what a new
 * barcode is happens only when the person has turned grocery look-ups on, exactly as on the grocery page.
 */
export default function ScanToPantry({ onChanged }) {
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState(null);            // what the last scan turned out to be
  const [product, setProduct] = useState(null);      // its name from the look-up, when that is on
  const [ingredients, setIngredients] = useState([]);
  const [which, setWhich] = useState('');
  const [name, setName] = useState('');
  const [size, setSize] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('');
  const [added, setAdded] = useState([]);            // what has gone in during this scanning
  const [error, setError] = useState('');
  const again = () => { setSeen(null); setProduct(null); setWhich(''); setName(''); setSize(''); setAmount(''); setUnit(''); setError(''); setRound((r) => r + 1); };

  const look = useCallback(async (code) => {
    setError('');
    try {
      const { data } = await axios.get('/api/kitchen/pantry/scan', { params: { code } });
      setSeen(data);
      if (data.ingredient) {
        const parts = sizeParts(data.ingredient.size);
        setSize(data.ingredient.size || ''); setAmount(parts.quantity); setUnit(parts.unit);
      } else {
        axios.get('/api/kitchen/ingredients').then(({ data: list }) => setIngredients(list)).catch(() => {});
        const found = await lookUpProduct(data.barcode);
        if (found) {
          setProduct(found); setName(found.name); setSize(found.size || '');
          const parts = sizeParts(found.size); setAmount(parts.quantity); setUnit(parts.unit);
        }
      }
    } catch (err) { setError(errorMessage(err, "Couldn't look that up")); setSeen({ failed: true }); }
  }, []);

  if (!seen) {
    return (
      <div className="space-y-2">
        {added.length > 0 && (
          <div className="rounded-lg bg-life-100 px-3 py-2 text-sm text-life-800" aria-live="polite" data-scanned-in>
            <p className="font-medium">In the pantry so far</p>
            <ul>{added.map((line, i) => <li key={i}>{line}</li>)}</ul>
          </div>
        )}
        <div className="space-y-2 [&_button]:min-h-[44px] [&_input]:min-h-[44px]"><Scanner key={round} onCode={look} label="Point the camera at the barcode on the package" /></div>
      </div>
    );
  }
  const another = <button type="button" onClick={again} className={`${quietButtonClass} min-h-[44px]`}>Scan another</button>;
  if (seen.failed) return <div className="space-y-3"><p className="text-sm text-red-600">{error}</p>{another}</div>;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const label = product ? [product.name, product.brand, product.size].filter(Boolean).join(', ') : null;
    const body = { code: seen.barcode, unit: unit.trim() || null, product: label, size: size.trim() || null };
    if (amount !== '') body.quantity = Number(amount);
    if (!seen.ingredient) { if (which === '') body.name = name; else body.ingredient_id = Number(which); }
    try {
      const { data } = await axios.post('/api/kitchen/pantry/scan', body);
      setAdded((list) => [...list, `${data.item.name}: now ${data.item.amount}${data.learned ? ' (remembered this barcode)' : ''}`]);
      onChanged();
      again();
    } catch (err) { setError(errorMessage(err, "Couldn't add that")); }
  };

  const amountFields = (
    <div className="grid grid-cols-2 gap-3">
      <Field label="How much"><input type="number" min="0" step="any" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="usual size" className={`${inputClass} min-h-[44px]`} /></Field>
      <Field label="Unit"><input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="oz, can, bag…" className={`${inputClass} min-h-[44px]`} /></Field>
    </div>
  );
  if (seen.ingredient) {
    return (
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-gray-800 dark:text-life-50"><span className="font-medium">{seen.ingredient.name}</span>
          {(seen.ingredient.product || seen.ingredient.size) && <span className="block text-xs text-gray-500 dark:text-life-300">{[seen.ingredient.product, seen.ingredient.size].filter(Boolean).join(' · ')}</span>}</p>
        <p className="text-sm text-gray-600 dark:text-life-100">{seen.in_pantry ? `You have ${seen.in_pantry.amount} in the pantry. This is added to it.` : "It isn't in the pantry yet."}</p>
        {amountFields}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-end gap-2">{another}<button type="submit" className={`${buttonClass} min-h-[44px]`}>Add to the pantry</button></div>
      </form>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-gray-800 dark:text-life-50">Life Is hasn't seen this one before (<span className="font-mono">{seen.barcode}</span>). Say what it is once, and it's known from then on.</p>
      {product && <p className="rounded-lg bg-life-50 px-3 py-2 text-sm text-gray-800 dark:bg-life-700 dark:text-life-50"><span className="block text-xs text-gray-500 dark:text-life-300">Open Food Facts says it's</span>{[product.name, product.brand, product.size].filter(Boolean).join(' · ')}</p>}
      <Field label="It's this ingredient">
        <select value={which} onChange={(e) => setWhich(e.target.value)} className={`${inputClass} min-h-[44px]`}>
          <option value="">Something new</option>
          {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </select>
      </Field>
      {which === '' && <Field label="What to call it *"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. coffee" className={`${inputClass} min-h-[44px]`} /></Field>}
      <Field label="The size on the package"><input value={size} onChange={(e) => setSize(e.target.value)} placeholder="30 oz, 400 g, 6" className={`${inputClass} min-h-[44px]`} /></Field>
      {amountFields}
      {which === '' && <p className="text-xs text-gray-500 dark:text-life-300">Use the everyday name ("coffee", not the brand), so recipes and the grocery list know it as the same thing.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-end gap-2">{another}<button type="submit" className={`${buttonClass} min-h-[44px]`}>Add to the pantry</button></div>
    </form>
  );
}
