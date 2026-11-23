import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';
import { useTags } from '../components/tags';

const insideOf = (tags, tag) => tags.filter((t) => t.path.startsWith(`${tag.path} > `));

/** Every tag, laid out as the tree it is. A tag is renamed, put inside another, merged into another, or removed here. */
export default function TagsPage() {
  const [tags, reload] = useTags();
  const [name, setName] = useState('');
  const [parent, setParent] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  if (!tags) return null;
  const add = async (e) => {
    e.preventDefault();
    try {
      await axios.post('/api/tags', { name, parent_id: parent === '' ? null : Number(parent) });
      setName('');
      setError('');
      reload();
    } catch (err) {
      setError(errorMessage(err, "Couldn't make that tag"));
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Tags</h1>
      </div>
      <p className="text-sm text-gray-600 dark:text-life-200">
        One list of tags for your household. Put them on things, recipes, projects, plans, spending, titles, pets, upkeep and dates. A tag can sit inside another,
        like Appliances inside Kitchen, and asking for Kitchen shows what is tagged with Appliances too.
      </p>
      <form onSubmit={add} className={`${cardClass} flex flex-wrap items-end gap-2`}>
        <div className="min-w-[10rem] flex-1"><Field label="A new tag"><input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kitchen" className={inputClass} /></Field></div>
        <div className="min-w-[10rem] flex-1">
          <Field label="Inside">
            <select value={parent} onChange={(e) => setParent(e.target.value)} className={`${inputClass} min-h-[44px]`}>
              <option value="">Nothing: at the top</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.path}</option>)}
            </select>
          </Field>
        </div>
        <button type="submit" className={`${buttonClass} min-h-[44px]`}>Add the tag</button>
        {error && <p className="w-full text-sm text-red-600">{error}</p>}
      </form>
      {tags.length === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>No tags yet. Add one above, or type one into the Tags box when you add or change anything.</div>
      ) : (
        <ul className={`${cardClass} divide-y divide-life-50 !p-2 dark:divide-life-700`} data-tag-tree>
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-2" style={{ paddingLeft: `${t.depth * 1.25}rem` }}>
              <Link to={`/tags/${t.id}`} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 px-2 text-sm text-life-800 hover:underline dark:text-life-50">
                <span className="truncate">{t.depth > 0 ? '↳ ' : ''}{t.name}</span>
                <span className="text-xs text-gray-500 dark:text-life-300">{t.total === 0 ? 'nothing yet' : `${t.total} ${t.total === 1 ? 'thing' : 'things'}`}</span>
              </Link>
              <button type="button" onClick={() => setEditing(t)} aria-label={`Change ${t.path}`} className={`${quietButtonClass} min-h-[44px]`}>Change</button>
            </li>
          ))}
        </ul>
      )}
      {editing && <ChangeTag tag={editing} tags={tags} onClose={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
    </div>
  );
}

function ChangeTag({ tag, tags, onClose, onDone }) {
  const [name, setName] = useState(tag.name);
  const [parent, setParent] = useState(tag.parent_id === null ? '' : String(tag.parent_id));
  const [into, setInto] = useState('');
  const [error, setError] = useState('');
  const below = new Set(insideOf(tags, tag).map((t) => t.id));
  const run = async (work) => {
    try { await work(); onDone(); } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
  };
  const save = (e) => {
    e.preventDefault();
    run(async () => {
      if (name.trim() !== tag.name) await axios.put(`/api/tags/${tag.id}`, { name });
      const wanted = parent === '' ? null : Number(parent);
      if (wanted !== tag.parent_id) await axios.put(`/api/tags/${tag.id}`, { parent_id: wanted });
    });
  };
  const merge = () => {
    if (!window.confirm(`Merge ${tag.path} into the tag you picked? What has ${tag.name} will have the other one, and ${tag.name} goes away.`)) return;
    run(() => axios.post(`/api/tags/${tag.id}/merge`, { into: Number(into) }));
  };
  const remove = () => {
    if (!window.confirm(`Delete the tag ${tag.path}? It comes off everything that has it. Tags inside it move up. Nothing else is deleted.`)) return;
    run(() => axios.delete(`/api/tags/${tag.id}`));
  };
  return (
    <Modal title={tag.path} onClose={onClose}>
      <div className="space-y-5">
        <form onSubmit={save} className="space-y-3">
          <Field label="Name"><input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
          <Field label="Inside">
            <select value={parent} onChange={(e) => setParent(e.target.value)} className={inputClass}>
              <option value="">Nothing: at the top</option>
              {tags.filter((t) => t.id !== tag.id && !below.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.path}</option>)}
            </select>
          </Field>
          <div className="text-right"><button type="submit" className={`${buttonClass} min-h-[44px]`}>Save</button></div>
        </form>
        <div className="space-y-2 border-t border-life-100 pt-4 dark:border-life-700">
          <Field label="Merge into another tag">
            <select value={into} onChange={(e) => setInto(e.target.value)} className={inputClass}>
              <option value="">Pick a tag</option>
              {tags.filter((t) => t.id !== tag.id).map((t) => <option key={t.id} value={t.id}>{t.path}</option>)}
            </select>
          </Field>
          <button type="button" disabled={into === ''} onClick={merge} className={`${quietButtonClass} min-h-[44px]`}>Merge them</button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="border-t border-life-100 pt-3 dark:border-life-700"><button type="button" onClick={remove} className="min-h-[44px] text-sm text-red-600 hover:underline">Delete this tag</button></div>
      </div>
    </Modal>
  );
}

/** One tag: where it sits, the tags inside it, and everything that has it (or one inside it), by kind. */
export function TagPage() {
  const { id } = useParams();
  const [page, setPage] = useState(undefined);
  const [tags, reload] = useTags();
  const [editing, setEditing] = useState(false);
  const load = () => axios.get(`/api/tags/${id}`).then(({ data }) => setPage(data)).catch(() => setPage(null));
  useEffect(() => { setPage(undefined); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (page === undefined) return null;
  if (page === null) return <p className="text-sm text-gray-600 dark:text-life-200">That tag isn't here. <Link to="/tags" className="underline">All tags</Link></p>;
  const node = (tags || []).find((t) => t.id === page.tag.id);
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-life-200">
        <Link to="/tags" className="underline">Tags</Link>
        {page.trail.map((t) => <span key={t.id}> › <Link to={`/tags/${t.id}`} className="underline">{t.name}</Link></span>)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">{page.tag.name}</h1>
        {node && <button type="button" onClick={() => setEditing(true)} className={`${quietButtonClass} min-h-[44px]`}>Change this tag</button>}
      </div>
      {page.inside.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-gray-600 dark:text-life-200">
          Inside it:
          {page.inside.map((t) => <Link key={t.id} to={`/tags/${t.id}`} className="inline-flex min-h-[44px] items-center rounded-full bg-life-50 px-3 text-life-700 hover:bg-life-100 dark:bg-life-700 dark:text-life-100">{t.path.slice(page.tag.path.length + 3)}</Link>)}
        </p>
      )}
      {page.total === 0 ? (
        <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Nothing has this tag yet. Add it from the Tags box when you add or change something, or choose several in a list and tag them together.</div>
      ) : (
        page.groups.map((g) => (
          <section key={g.kind} className={cardClass} aria-label={g.label}>
            <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">{g.label} <span className="text-sm font-normal text-gray-500 dark:text-life-300">{g.items.length}</span></h2>
            <ul className="divide-y divide-life-50 dark:divide-life-700">
              {g.items.map((it) => (
                <li key={`${it.kind}-${it.id}`}>
                  <Link to={it.link} className="flex min-h-[44px] items-center gap-2 py-2 text-sm text-gray-800 hover:underline dark:text-life-50">
                    <span aria-hidden="true">{it.icon}</span>
                    <span className="flex-1">{it.title}</span>
                    {it.detail && <span className="text-xs text-gray-500 dark:text-life-300">{it.detail}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {editing && node && <ChangeTag tag={node} tags={tags} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); load(); }} />}
    </div>
  );
}
