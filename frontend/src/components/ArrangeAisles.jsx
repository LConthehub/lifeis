import { useEffect, useState } from 'react';
import axios from 'axios';
import { buttonClass, quietButtonClass, errorMessage } from './ui';

/**
 * Put the aisles in the order a shop runs in. Each row moves up and down with buttons (and can be dragged where the
 * device allows it). Kept per shop; with it, the list grouped by aisle follows when you shop there.
 */
export default function ArrangeAisles({ shop, onSaved }) {
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(null);
  useEffect(() => {
    axios.get('/api/kitchen/ingredients').then(({ data }) => {
      const known = [...new Set(data.map((i) => i.aisle).filter(Boolean))].sort((a, b) => a.localeCompare(b));
      const saved = shop.aisle_order || [];
      const lower = new Set(saved.map((a) => a.toLowerCase()));
      setOrder([...saved, ...known.filter((a) => !lower.has(a.toLowerCase()))]);
    }).catch(() => setOrder(shop.aisle_order || []));
  }, [shop.aisle_order]);
  if (!order) return null;
  const move = (from, to) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order]; const [one] = next.splice(from, 1); next.splice(to, 0, one); setOrder(next);
  };
  const save = async (aisles) => {
    setError('');
    try { onSaved((await axios.put(`/api/shopping/stores/${shop.store_id}/aisles`, { aisles })).data); } catch (err) { setError(errorMessage(err, "Couldn't save the order")); }
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-700 dark:text-life-100">Put the aisles in the order you walk them at {shop.store}. When the list is laid out by aisle and you are shopping at {shop.store}, it follows this order. Other stores keep theirs.</p>
      {order.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">No aisles yet. Give an ingredient an aisle and it shows up here.</p> : (
        <ol className="space-y-1" data-aisle-order>
          {order.map((aisle, i) => (
            <li key={aisle} draggable onDragStart={() => setDragging(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragging !== null) move(dragging, i); setDragging(null); }}
              className="flex items-center gap-2 rounded-lg bg-life-50 px-3 py-1 dark:bg-life-700">
              <span className="w-6 text-xs text-gray-500 dark:text-life-300">{i + 1}</span>
              <span className="min-w-0 flex-1 break-words text-sm text-gray-800 dark:text-life-50">{aisle}</span>
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${aisle} up`} className={`${quietButtonClass} min-h-[44px] min-w-[44px]`}>↑</button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label={`Move ${aisle} down`} className={`${quietButtonClass} min-h-[44px] min-w-[44px]`}>↓</button>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => save([])} className={`${quietButtonClass} min-h-[44px]`}>Forget this order</button>
        <button type="button" onClick={() => save(order)} disabled={order.length === 0} className={`${buttonClass} min-h-[44px]`}>Save the order</button>
      </div>
    </div>
  );
}
