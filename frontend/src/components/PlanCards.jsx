import { useState } from 'react';
import axios from 'axios';
import { inputClass, quietButtonClass, cardClass } from './ui';

const tall = `${inputClass} min-h-[44px]`;
const iconButton = 'flex h-11 w-11 flex-none items-center justify-center rounded-lg text-gray-500 hover:bg-life-50 hover:text-life-800 disabled:opacity-30 dark:text-life-300 dark:hover:bg-life-800';

/**
 * Traditions: short lines of what is always done ("Grandpa carves"). Add, reword (change the words and leave the box),
 * reorder, check off for this year, and remove. On a yearly plan, next year starts with the same lines, unchecked.
 */
export function Traditions({ plan, act }) {
  const [words, setWords] = useState('');
  const lines = plan.traditions;
  const add = async (e) => {
    e.preventDefault();
    if (!words.trim()) return;
    if (await act(() => axios.post(`/api/plans/${plan.id}/traditions`, { words }))) setWords('');
  };
  return (
    <section className={cardClass} aria-label="Traditions">
      <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">
        Traditions {lines.length > 0 && <span className="text-sm font-normal text-gray-500 dark:text-life-300">{lines.filter((l) => l.done).length} of {lines.length}</span>}
      </h2>
      {lines.length === 0 && <p className="mb-2 text-sm text-gray-500 dark:text-life-300">The things you always do, in a few words: "Grandpa carves", "Kids pick the movie".{plan.yearly ? ' Next year starts with the same lines, unchecked.' : ''}</p>}
      <ul>
        {lines.map((l, n) => (
          <li key={`${l.id}:${l.words}`} className="flex flex-wrap items-center gap-1" data-tradition>
            <input type="checkbox" checked={l.done} onChange={(e) => act(() => axios.put(`/api/plans/traditions/${l.id}`, { done: e.target.checked }))} aria-label={`${l.words} is done`} className="m-3 h-5 w-5 flex-none accent-life-600" />
            <input defaultValue={l.words} maxLength={200} aria-label={`Reword ${l.words}`}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== l.words) act(() => axios.put(`/api/plans/traditions/${l.id}`, { words: v })); else e.target.value = l.words; }}
              className={`${tall} min-w-0 flex-1 basis-32 ${l.done ? 'text-gray-400 line-through' : ''}`} />
            <span className="flex flex-none">
              <button type="button" disabled={n === 0} onClick={() => act(() => axios.post(`/api/plans/traditions/${l.id}/move`, { direction: 'up' }))} aria-label={`Move ${l.words} up`} className={iconButton}>↑</button>
              <button type="button" disabled={n === lines.length - 1} onClick={() => act(() => axios.post(`/api/plans/traditions/${l.id}/move`, { direction: 'down' }))} aria-label={`Move ${l.words} down`} className={iconButton}>↓</button>
              <button type="button" onClick={() => act(() => axios.delete(`/api/plans/traditions/${l.id}`))} aria-label={`Remove ${l.words}`} className={`${iconButton} hover:text-red-600`}>×</button>
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <input value={words} onChange={(e) => setWords(e.target.value)} maxLength={200} placeholder="Something you always do" aria-label="Something you always do" className={tall} />
        <button type="submit" className={`${quietButtonClass} min-h-[44px]`}>Add</button>
      </form>
    </section>
  );
}

