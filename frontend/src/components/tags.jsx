import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { buttonClass, errorMessage, inputClass, quietButtonClass } from './ui';

/**
 * Tags, as the pages use them: a picker for a form, chips for a row, a filter for a list, and a way to tag many
 * rows at once. Tags are one list for the household and nest ("Kitchen > Appliances"); asking for a tag asks
 * for the tags inside it too. See core/'s tags.ts.
 */

const chipClass = 'relative inline-flex items-center rounded-full bg-life-50 px-2 py-0.5 text-[11px] text-life-700 ring-1 ring-life-100 hover:bg-life-100 dark:bg-life-700 dark:text-life-100 dark:ring-life-600';

/** The household's tags, flat and in tree order; reloaded with `reload`. */
export function useTags() {
  const [tags, setTags] = useState(null);
  const reload = useCallback(() => axios.get('/api/tags').then(({ data }) => setTags(data)).catch(() => setTags([])), []);
  useEffect(() => { reload(); }, [reload]);
  return [tags, reload];
}

/**
 * Small tags on a row. Each leads to its tag's page. The tap area runs a little above and below the chip so
 * a finger can hit it. Never put these inside another link.
 */
export function TagChips({ tags, className = '' }) {
  if (!tags || tags.length === 0) return null;
  return (
    <span className={`flex flex-wrap gap-1.5 ${className}`} data-tag-chips>
      {tags.map((t) => (
        <Link key={t.id} to={`/tags/${t.id}`} title={t.path} className={`${chipClass} before:absolute before:inset-x-0 before:-top-[11px] before:-bottom-[11px] before:content-['']`}>{t.name}</Link>
      ))}
    </span>
  );
}

/** The same chips where they are not links (inside a row that is one). */
export function TagWords({ tags, className = '' }) {
  if (!tags || tags.length === 0) return null;
  return <span className={`flex flex-wrap gap-1.5 ${className}`} data-tag-chips>{tags.map((t) => <span key={t.id} title={t.path} className={chipClass}>{t.name}</span>)}</span>;
}

/**
 * Type to find a tag, or to make one ("Kitchen > Appliances" makes both). `value` is a list of tags ({ id, name,
 * path }); one just typed has no id yet and is made when the form is saved (see `saveTags`).
 */
export function TagPicker({ value, onChange, label = 'Tags' }) {
  const [all] = useTags();
  const [text, setText] = useState('');
  const word = text.trim().toLowerCase();
  const taken = new Set(value.map((t) => (t.id !== null ? `id:${t.id}` : `name:${t.path.toLowerCase()}`)));
  const options = (all || []).filter((t) => !taken.has(`id:${t.id}`) && (!word || t.path.toLowerCase().includes(word))).slice(0, 6);
  const exact = (all || []).some((t) => t.path.toLowerCase() === word) || taken.has(`name:${word}`);
  const add = (tag) => { onChange([...value, tag]); setText(''); };
  const make = () => { if (word && !exact) add({ id: null, name: text.split('>').pop().trim(), path: text.split('>').map((p) => p.trim()).filter(Boolean).join(' > ') }); };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    if (!word) { if (e.key === 'Enter') return; e.preventDefault(); return; }
    e.preventDefault();
    const hit = (all || []).find((t) => t.path.toLowerCase() === word && !taken.has(`id:${t.id}`)) || (options.length === 1 ? options[0] : null);
    if (hit) add(hit); else make();
  };
  return (
    <div className="space-y-2" data-tag-picker>
      <span className="block text-xs font-medium text-gray-600 dark:text-life-200">{label}</span>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags on this">
          {value.map((t, i) => (
            <li key={t.id ?? `n${i}`} className="inline-flex items-center rounded-full bg-life-50 pl-3 text-sm text-life-700 ring-1 ring-life-100 dark:bg-life-700 dark:text-life-100 dark:ring-life-600">
              <span>{t.path}</span>
              <button type="button" onClick={() => onChange(value.filter((_, n) => n !== i))} aria-label={`Take off ${t.path}`} className="flex h-11 w-11 items-center justify-center text-lg leading-none text-gray-500 hover:text-red-600">×</button>
            </li>
          ))}
        </ul>
      )}
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Type to find or make a tag" aria-label={`Add to ${label.toLowerCase()}`} autoComplete="off" className={inputClass} />
      {(options.length > 0 || (word && !exact)) && (
        <ul className="divide-y divide-life-50 overflow-hidden rounded-xl ring-1 ring-life-100 dark:divide-life-700 dark:ring-life-700" aria-label="Tag choices">
          {options.map((t) => (
            <li key={t.id}><button type="button" onClick={() => add(t)} className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-gray-800 hover:bg-life-50 dark:text-life-50 dark:hover:bg-life-700">{t.path}</button></li>
          ))}
          {word && !exact && (
            <li><button type="button" onClick={make} className="flex min-h-[44px] w-full items-center px-3 text-left text-sm font-medium text-life-700 hover:bg-life-50 dark:text-life-100 dark:hover:bg-life-700">Make the tag "{text.split('>').map((p) => p.trim()).filter(Boolean).join(' > ')}"</button></li>
          )}
        </ul>
      )}
    </div>
  );
}

/** Makes the tags that were only typed, then sets exactly these tags on a thing. Returns the saved tags. */
export async function saveTags(kind, id, tags) {
  const ids = [];
  for (const t of tags) {
    if (t.id !== null && t.id !== undefined) { ids.push(t.id); continue; }
    const { data } = await axios.post('/api/tags', { name: t.path });
    ids.push(data.id);
  }
  const { data } = await axios.put(`/api/tags/on/${kind}/${id}`, { tag_ids: [...new Set(ids)] });
  return data;
}

/** A list's tag filter. Nothing shows until the household has some tags. `value` is a tag's id, or '' for all. */
export function TagFilter({ value, onChange, className = '' }) {
  const [tags] = useTags();
  if (!tags || (tags.length === 0 && !value)) return null;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Tag" className={`${inputClass} !w-auto min-h-[44px] max-w-full ${className}`}>
      <option value="">All tags</option>
      {tags.map((t) => <option key={t.id} value={t.id}>{t.path} ({t.total})</option>)}
    </select>
  );
}

/** Choosing rows in a list, to tag them together. */
export function useSelecting() {
  const [on, setOn] = useState(false);
  const [ids, setIds] = useState(() => new Set());
  return useMemo(() => ({
    on, ids,
    toggle: (id) => setIds((before) => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
    all: (list) => setIds(new Set(list)),
    start: () => setOn(true),
    stop: () => { setOn(false); setIds(new Set()); },
  }), [on, ids]);
}

/** The box beside a row while choosing. */
export function PickBox({ sel, id, name }) {
  if (!sel.on) return null;
  return (
    <label className="flex h-11 w-11 shrink-0 items-center justify-center">
      <input type="checkbox" checked={sel.ids.has(id)} onChange={() => sel.toggle(id)} aria-label={`Choose ${name}`} className="h-5 w-5 accent-life-600" />
    </label>
  );
}

/** The button that starts (or ends) choosing. */
export function SelectButton({ sel }) {
  return <button type="button" onClick={sel.on ? sel.stop : sel.start} aria-pressed={sel.on} className={`${quietButtonClass} min-h-[44px]`}>{sel.on ? 'Stop choosing' : 'Choose several'}</button>;
}

/**
 * Shows while choosing: how many are chosen, and the two things to do with them. `list` is the ids on show
 * (for "Choose all"). `kind` is the kind of thing; `noun` is what to call them.
 */
export function BulkBar({ sel, kind, list, noun = 'things', onDone }) {
  const [mode, setMode] = useState(null);
  const [picked, setPicked] = useState([]);
  const [error, setError] = useState('');
  if (!sel.on) return null;
  const n = sel.ids.size;
  const close = () => { setMode(null); setPicked([]); setError(''); };
  const apply = async () => {
    try {
      const ids = [];
      for (const t of picked) {
        if (t.id !== null) { ids.push(t.id); continue; }
        ids.push((await axios.post('/api/tags', { name: t.path })).data.id);
      }
      await axios.post('/api/tags/bulk', { kind, ids: [...sel.ids], add: mode === 'add' ? ids : [], remove: mode === 'remove' ? ids : [] });
      close();
      sel.stop();
      onDone();
    } catch (err) {
      setError(errorMessage(err, "Couldn't change the tags"));
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-life-50 px-3 py-2 dark:bg-life-800" role="region" aria-label="Tag several" data-bulk-bar>
      <span className="mr-auto text-sm text-life-800 dark:text-life-50">{n === 0 ? `Choose ${noun} to tag` : `${n} chosen`}</span>
      <button type="button" onClick={() => sel.all(list)} className={`${quietButtonClass} min-h-[44px]`}>Choose all</button>
      <button type="button" disabled={n === 0} onClick={() => setMode('add')} className={`${buttonClass} min-h-[44px] !px-3`}>Add a tag</button>
      <button type="button" disabled={n === 0} onClick={() => setMode('remove')} className={`${quietButtonClass} min-h-[44px]`}>Take a tag off</button>
      {mode && (
        <Modal title={mode === 'add' ? `Add tags to ${n} ${n === 1 ? noun.replace(/s$/, '') : noun}` : `Take tags off ${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`} onClose={close}>
          <div className="space-y-3">
            <TagPicker value={picked} onChange={setPicked} label={mode === 'add' ? 'Tags to add' : 'Tags to take off'} />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end"><button type="button" disabled={picked.length === 0} onClick={apply} className={buttonClass}>{mode === 'add' ? 'Add them' : 'Take them off'}</button></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
