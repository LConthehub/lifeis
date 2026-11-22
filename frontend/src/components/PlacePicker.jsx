import { useState } from 'react';
import axios from 'axios';
import { inputClass, quietButtonClass, errorMessage } from './ui';

const NEW = 'new';

/**
 * Where something is: one of the places already kept, or a new one made right here. A new place can be
 * several levels at once ("Bedroom › Bookshelf"): any level that already exists is used, and only the
 * missing ones are made, each inside the one before.
 */
export default function PlacePicker({ value, places, onChange, onPlaces }) {
  const [typing, setTyping] = useState(null);   // null, or the new place's words
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const make = async () => {
    const names = typing.split(/\s*(?:›|>|\/)\s*/).map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    setBusy(true); setError('');
    try {
      let list = places;
      let parent = null;
      for (const name of names) {
        const same = (p) => p.parent_id === parent && p.name.toLowerCase() === name.toLowerCase();
        let found = list.find(same);
        if (!found) {
          list = (await axios.post('/api/things/places', { name, parent_id: parent })).data;
          found = list.filter(same).sort((a, b) => b.id - a.id)[0];
        }
        parent = found.id;
      }
      onPlaces(list);
      onChange(parent);
      setTyping(null);
    } catch (err) { setError(errorMessage(err, "Couldn't make that place")); }
    setBusy(false);
  };

  if (typing !== null) {
    return (
      <div className="space-y-1">
        <div className="flex gap-1.5">
          <input autoFocus value={typing} onChange={(e) => setTyping(e.target.value)} aria-label="The new place"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); make(); } if (e.key === 'Escape') setTyping(null); }}
            placeholder="Bedroom › Bookshelf" className={inputClass} />
          <button type="button" onClick={make} disabled={busy || !typing.trim()} className={quietButtonClass}>Add</button>
        </div>
        <p className="text-xs text-gray-500 dark:text-life-300">
          Put › or &gt; between a room and what's in it. <button type="button" onClick={() => setTyping(null)} className="underline">Back to the list</button>
        </p>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <select value={value ?? ''} onChange={(e) => (e.target.value === NEW ? setTyping('') : onChange(e.target.value === '' ? '' : Number(e.target.value)))} className={inputClass}>
      <option value="">No place</option>
      {places.map((p) => <option key={p.id} value={p.id}>{p.path}</option>)}
      <option value={NEW}>➕ A new place…</option>
    </select>
  );
}
