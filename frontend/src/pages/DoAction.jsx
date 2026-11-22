import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import axios from 'axios';
import { Field, inputClass, buttonClass, cardClass, errorMessage } from '../components/ui';

/**
 * One short request, opened from outside Life Is: a link (/do/add-to-groceries?item=eggs), a shortcut on the
 * app icon, Siri or Google. Something that only answers runs at once. Something that adds waits for a tap,
 * so a link alone can never change anything.
 */
export default function DoAction() {
  const { id } = useParams();
  const { search } = useLocation();
  const [action, setAction] = useState(undefined);
  const [given, setGiven] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (found, values) => {
    setBusy(true); setError(''); setResult(null);
    try {
      const { data } = found.does === 'reads'
        ? await axios.get(`/api/actions/${found.id}`, { params: values })
        : await axios.post(`/api/actions/${found.id}`, values);
      setResult(data);
    } catch (err) { setError(errorMessage(err, "Couldn't do that")); }
    setBusy(false);
  };

  useEffect(() => {
    const values = Object.fromEntries(new URLSearchParams(search));
    setGiven(values);
    axios.get('/api/actions').then(({ data }) => {
      const found = data.find((a) => a.id === id) ?? null;
      setAction(found);
      const ready = found && found.params.every((p) => !p.required || values[p.name]);
      if (found?.does === 'reads' && ready) run(found, values);
    }).catch(() => setAction(null));
  }, [id, search]); // eslint-disable-line react-hooks/exhaustive-deps

  if (action === undefined) return null;
  if (action === null) return <p className="text-sm text-gray-600 dark:text-life-200">Life Is doesn't know how to do that. <Link to="/" className="underline">Home</Link></p>;
  const submit = (e) => { e.preventDefault(); run(action, given); };

  return (
    <section className={`${cardClass} mx-auto max-w-md space-y-3`} data-action={action.id}>
      <h1 className="text-lg font-semibold text-life-800 dark:text-life-50">{action.title}</h1>
      {!result && (action.params.length > 0 || action.does === 'writes') && (
        <form onSubmit={submit} className="space-y-3">
          {action.params.map((p) => (
            <Field key={p.name} label={`${p.label[0].toUpperCase()}${p.label.slice(1)}${p.required ? ' *' : ''}`}>
              <input required={p.required} inputMode={p.kind === 'money' ? 'decimal' : undefined} autoFocus={p === action.params[0]}
                value={given[p.name] ?? ''} onChange={(e) => setGiven({ ...given, [p.name]: e.target.value })} className={inputClass} />
            </Field>
          ))}
          <div className="flex justify-end"><button type="submit" disabled={busy} className={buttonClass}>{busy ? 'Just a moment…' : action.does === 'writes' ? 'Do it' : 'Ask'}</button></div>
        </form>
      )}
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {result && (
        <>
          <p className="text-gray-800 dark:text-life-50" data-said>{result.say}</p>
          <div className="flex gap-3 text-sm">
            {result.open && <Link to={result.open} className="text-life-600 hover:underline dark:text-life-200">Open it in Life Is →</Link>}
            <Link to="/" className="text-gray-500 hover:underline dark:text-life-300">Home</Link>
          </div>
        </>
      )}
    </section>
  );
}
