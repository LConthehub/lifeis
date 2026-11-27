import { useState } from 'react';
import axios from 'axios';
import { Field, inputClass, errorMessage } from './ui';
import { STAR_CHOICES, starsText } from './collectionTools';

/**
 * A person's own rating of a title, in half stars. Shown as plain text (stars drawn with the ★ and ½ letters, with the number
 * in words after it) and set with a list of choices, which a keyboard and a screen reader both use as they do any list.
 */
export default function StarRating({ id, stars, onSaved }) {
  const [error, setError] = useState('');
  const change = async (e) => {
    setError('');
    try {
      const { data } = await axios.put(`/api/media/${id}/stars`, { stars: e.target.value === '' ? null : Number(e.target.value) });
      onSaved(data);
    } catch (err) { setError(errorMessage(err, "That rating didn't save. Try again.")); }
  };
  return (
    <div className="mt-2 flex flex-wrap items-end gap-3" data-rating>
      <div className="w-44">
        <Field label="Your rating">
          <select value={stars == null ? '' : String(stars)} onChange={change} className={`${inputClass} min-h-[44px]`} aria-describedby={`rating-${id}`}>
            {STAR_CHOICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      <p id={`rating-${id}`} className="min-h-[44px] flex items-center text-xl text-honey-700 dark:text-honey-100" data-stars aria-label={stars == null ? 'Not rated' : `${stars} out of 5 stars`}>
        {stars == null ? <span className="text-sm text-gray-500 dark:text-life-300">Only you see this.</span> : <span aria-hidden="true">{starsText(stars)} <span className="text-sm text-gray-600 dark:text-life-200">{stars}</span></span>}
      </p>
      {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
    </div>
  );
}
