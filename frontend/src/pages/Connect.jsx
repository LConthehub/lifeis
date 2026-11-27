import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage, Details, errorDetails } from '../components/ui';
import { SectionTicks } from '../components/Connector';

// The page an AI app sends a signed-in person to. They name the connection, tick what it may see, and answer.
// Nothing is shared until they press Allow. Either answer sends them back to the app.
const tall = 'min-h-[44px]';

export default function Connect() {
  const { search } = useLocation();
  const [ask, setAsk] = useState(null);
  const [refusal, setRefusal] = useState('');
  const [refusalWhy, setRefusalWhy] = useState('');
  const [name, setName] = useState('');
  const [sections, setSections] = useState([]);
  const [mayAdd, setMayAdd] = useState(false);
  const [error, setError] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const query = Object.fromEntries(new URLSearchParams(search));

  useEffect(() => {
    axios.get(`/api/connector/request${search}`)
      .then(({ data }) => { setAsk(data); setName(data.suggested_name ?? ''); })
      .catch((err) => { setRefusal(errorMessage(err, "This request can't be used.")); setRefusalWhy(errorDetails(err)); });
  }, [search]);

  const answer = async (kind) => {
    setBusy(true); setError('');
    const body = { client_id: query.client_id, redirect_uri: query.redirect_uri, state: query.state };
    if (kind === 'allow') Object.assign(body, { code_challenge: query.code_challenge, code_challenge_method: query.code_challenge_method, resource: query.resource, name, sections, may_add: mayAdd });
    try {
      const { data } = await axios.post(`/api/connector/${kind}`, body);
      window.location.assign(data.redirect);
    } catch (err) { setError(errorMessage(err, "That didn't work. Try again in a moment.")); setWhy(errorDetails(err)); setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4 py-4" data-connect>
      <section className={`${cardClass} space-y-4`}>
        <h1 className="text-lg font-semibold text-life-800 dark:text-life-50">Connect an AI app to your Life Is</h1>
        {refusal && <div className="text-sm text-gray-800 dark:text-life-50" role="alert" data-refusal><p>{refusal}</p><Details error={refusalWhy} /></div>}
        {!refusal && !ask && <p className="text-sm text-gray-600 dark:text-life-100">One moment…</p>}
        {ask && (
          <form onSubmit={(e) => { e.preventDefault(); answer('allow'); }} className="space-y-4">
            <p className="text-sm text-gray-800 dark:text-life-50"><strong>{ask.app_name}</strong> is asking to use your Life Is. After you answer, you go back to <strong className="break-all">{ask.goes_to}</strong>.</p>
            <p className="text-sm text-gray-600 dark:text-life-100"><span className="font-medium">What it does:</span> {ask.service.sends}</p>
            <Field label="Name this connection *">
              <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} ${tall}`} />
            </Field>
            <SectionTicks sections={ask.sections} value={sections} onChange={setSections} />
            <label className={`flex ${tall} items-start gap-3 text-sm text-gray-800 dark:text-life-50`}>
              <input type="checkbox" checked={mayAdd} onChange={(e) => setMayAdd(e.target.checked)} className="mt-0.5 h-5 w-5 flex-none" />
              <span>It may add things <span className="block text-xs text-gray-500 dark:text-life-300">{ask.adds}</span></span>
            </label>
            <p className="text-sm text-gray-600 dark:text-life-100">{ask.never}</p>
            <p className="text-sm text-gray-600 dark:text-life-100">A connection ends by itself if you don't use it for {ask.unused_days} days. You can change or cut it off in Settings at any time.</p>
            {error && <div className="text-sm text-red-600" role="alert"><p>{error}</p><Details error={why} /></div>}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={busy || !name.trim()} className={`${buttonClass} ${tall}`}>Allow</button>
              <button type="button" disabled={busy} onClick={() => answer('deny')} className={`${quietButtonClass} ${tall}`}>Don't allow</button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
