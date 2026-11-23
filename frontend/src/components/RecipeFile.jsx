import { useState } from 'react';
import axios from 'axios';
import { Field, buttonClass, errorMessage } from './ui';
import { bringRecipesIn, unpackRecipeFile } from './unpackRecipes';

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/**
 * Bring many recipes in from another app's file: Paprika's export, recipe JSON, or a zip Life Is made. The file is
 * opened here in the page and looked over first, so what will happen is said before anything is kept.
 * Nothing is looked up or sent anywhere but to Life Is itself.
 */
export default function RecipeFile({ onDone }) {
  const [seen, setSeen] = useState(null);    // { body, photos, look, pictures }
  const [progress, setProgress] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(''); setSeen(null); setDone(null); setName(file.name); setBusy(true);
    try {
      const { body, pictures, photos } = await unpackRecipeFile(file);
      setSeen({ body, photos, pictures, look: (await axios.post('/api/kitchen/recipes/file/read', body)).data });
    } catch (err) {
      setError(err?.response ? errorMessage(err, "Couldn't read that file") : err?.message || "Couldn't read that file");
    }
    setBusy(false);
  };
  const bring = async () => {
    setError(''); setBusy(true); setProgress('');
    try {
      setDone(await bringRecipesIn(seen.body, seen.photos, (n) => setProgress(`${n.toLocaleString('en-US')} of ${seen.body.sources.length.toLocaleString('en-US')} sent…`)));
      setSeen(null);
    } catch (err) { setError(err?.message || "Couldn't bring them in"); }
    setBusy(false);
  };

  if (done) {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg bg-life-50 px-3 py-2 text-sm text-life-800 dark:bg-life-700 dark:text-life-50">
          Brought in: {plural(done.added, 'recipe', 'recipes')} added, {done.already} already there, {done.failed.length} could not be read{done.pictures > 0 ? `, ${plural(done.pictures, 'picture', 'pictures')} kept` : ''}.
        </p>
        <Failed list={done.failed} />
        <div className="text-right"><button type="button" onClick={() => onDone(done)} className={`${buttonClass} min-h-[44px]`}>Done</button></div>
      </div>
    );
  }
  const look = seen?.look;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">
        Choose the file Paprika exports (Paprika: Settings, Export, All recipes, which makes a <span className="font-medium">.paprikarecipes</span> file),
        a recipe <span className="font-medium">.json</span> file, or the zip you get from "Download all recipes" in another copy of Life Is.
        The file is opened here and nothing is sent anywhere but to Life Is itself. Every recipe is kept word for word, and a recipe you already have is not added twice.
        A picture in the file is made smaller and kept as that recipe's picture.
      </p>
      <Field label="A file">
        <input type="file" accept=".paprikarecipes,.paprikarecipe,.zip,.json,.gz,application/zip,application/json" onChange={choose} disabled={busy}
          className="block min-h-[44px] w-full text-sm text-gray-700 dark:text-life-100" aria-label="Choose a file of recipes" />
      </Field>
      <p className="text-xs text-gray-500 dark:text-life-300">
        AnyList has no way to export, so there is nothing to bring in from it. A recipe pinned on Pinterest is a web page: open the pin's website
        and use "From a website".
      </p>
      {busy && !look && <p className="text-sm text-life-700 dark:text-life-200" role="status">Reading {name}…</p>}
      {busy && look && progress && <p className="text-sm text-life-700 dark:text-life-200" role="status">{progress}</p>}
      {look && (
        <div className="space-y-2 rounded-lg bg-life-50 p-3 text-sm dark:bg-life-700" data-look="recipes">
          <p className="font-medium text-life-800 dark:text-life-50">
            {plural(look.found, 'recipe', 'recipes')} found{look.already > 0 ? `, ${look.already} already in Life Is` : ''}{look.failed.length > 0 ? `, ${look.failed.length} that can't be read` : ''}.
          </p>
          <ul className="text-xs text-gray-600 dark:text-life-200">
            {look.first.map((title, i) => <li key={i} className="truncate">{title}</li>)}
            {look.found - look.failed.length > look.first.length && <li>and {look.found - look.failed.length - look.first.length} more</li>}
          </ul>
          {seen.pictures > 0 && (
            <p className="text-xs text-gray-600 dark:text-life-200" data-look="pictures">
              {look.pictures > 0 ? `${plural(look.pictures, 'picture', 'pictures')} will come in with them.` : 'No pictures will be added.'}
              {look.already > 0 && ' A recipe already in Life Is is not changed, so it is not given a picture.'}
            </p>
          )}
          <Failed list={look.failed} />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {look && (
        <div className="flex justify-end">
          <button type="button" onClick={bring} disabled={busy || look.fresh === 0} className={`${buttonClass} min-h-[44px]`}>
            {look.fresh === 0 ? 'Nothing new to bring in' : busy ? 'Bringing them in…' : `Bring in ${look.fresh}`}
          </button>
        </div>
      )}
    </div>
  );
}

function Failed({ list }) {
  if (list.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-red-700 dark:text-red-300" aria-label="Recipes that could not be read">
      {list.slice(0, 20).map((one, i) => <li key={i} className="break-words">{one.name}: {one.why}</li>)}
      {list.length > 20 && <li>and {list.length - 20} more</li>}
    </ul>
  );
}
