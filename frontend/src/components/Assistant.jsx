import { useEffect, useState } from 'react';
import axios from 'axios';
import Icon from './Icon';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';

const AREAS = [
  ['kitchen', 'The kitchen', 'recipes and their ingredients, the pantry, the grocery list, this week’s meals'],
  ['things', 'Your things', 'what you keep, of what kind, how much, and where'],
  ['projects', 'Projects', 'open projects, what they use and are short of, their budgets'],
  ['spending', 'Spending', 'this month’s categories and what was spent, including categories shared with you'],
  ['calendar', 'The calendar', 'the next 30 days; other calendars you follow go only as “busy”'],
];

/** Settings → Outside services: the assistant, off until turned on, with what it sends said plainly. */
export function AssistantService() {
  const [a, setA] = useState(null);
  const [form, setForm] = useState(null);
  const [models, setModels] = useState(null);
  const [phoneState, setPhoneState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { axios.get('/api/assistant').then(({ data }) => setA(data)).catch(() => {}); }, []);
  if (!a) return null;
  const start = () => { setForm({ enabled: true, source: a.source, url: a.url, model: a.model, cloud_ok: a.cloud_ok, key: '', areas: a.areas }); setMessage(''); setModels(null); };
  const set = (name) => (e) => setForm({ ...form, [name]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const tick = (area) => setForm({ ...form, areas: form.areas.includes(area) ? form.areas.filter((x) => x !== area) : [...form.areas, area] });
  const onPhone = form?.source === 'phone';
  const checkPhone = async () => { setMessage(''); try { setPhoneState((await axios.post('/api/assistant/phone')).data); } catch (err) { setMessage(errorMessage(err, "Couldn't check")); } };
  let local = true;
  if (form && !onPhone) { try { const host = new URL(form.url).hostname; local = /^(localhost|host\.docker\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)|\.(local|lan|home\.arpa|ts\.net|internal)$/.test(host); } catch { /* not yet an address */ } }
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMessage('');
    try { const { data } = await axios.put('/api/assistant', { ...form, key: form.key || undefined }); setA(data); setForm(null); } catch (err) { setMessage(errorMessage(err, "Couldn't save that")); }
    setBusy(false);
  };
  const look = async () => {
    setMessage('');
    try {
      await axios.put('/api/assistant', { url: form.url, cloud_ok: form.cloud_ok, key: form.key || undefined });
      setModels((await axios.post('/api/assistant/models')).data.models);
    } catch (err) { setMessage(errorMessage(err, "Couldn't reach it")); }
  };
  const off = async () => setA((await axios.put('/api/assistant', { enabled: false })).data);

  return (
    <div className="py-3" data-assistant-settings>
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50"><Icon of="assistant" /> An AI assistant</h3>
        <span className={`rounded px-1.5 text-[11px] ${a.enabled ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{a.enabled ? (a.source === 'phone' ? 'On, this device' : a.local ? 'On, at home' : 'On, cloud') : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Ask questions about your household in your own words. {a.phone ? `It can use this device's own ${a.phone.name}, or a model you run yourself.` : 'It uses a model you run yourself, such as Ollama or LM Studio.'} <span className="font-medium">What it does:</span> {a.service.sends}
      </p>
      {!a.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p> : !form ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-800 dark:text-life-50">
          {a.enabled && (a.source === 'phone'
            ? <span className="mr-auto">Using this device's own <span className="font-medium">{a.phone?.name}</span>. Nothing leaves the device.</span>
            : <span className="mr-auto break-all">Using <span className="font-medium">{a.model || 'the default model'}</span> at {a.url}</span>)}
          <button type="button" onClick={start} className={quietButtonClass}>{a.enabled ? 'Change' : 'Set it up'}</button>
          {a.enabled && <button type="button" onClick={off} className={quietButtonClass}>Turn off</button>}
        </div>
      ) : (
        <form onSubmit={save} className="mt-2 space-y-3 rounded-lg bg-life-50/60 p-3 dark:bg-life-800">
          {a.phone && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-gray-700 dark:text-life-100">Where answers come from</legend>
              <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-life-50">
                <input type="radio" name="source" checked={onPhone} onChange={() => setForm({ ...form, source: 'phone' })} className="mt-1" />
                <span>This device's own {a.phone.name} <span className="text-xs text-gray-500 dark:text-life-300">— built in, and nothing leaves the device. It is small, so it is given less to look at and keeps its answers simple.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm text-gray-800 dark:text-life-50">
                <input type="radio" name="source" checked={!onPhone} onChange={() => setForm({ ...form, source: 'address' })} className="mt-1" />
                <span>A model at an address <span className="text-xs text-gray-500 dark:text-life-300">— one you run yourself at home, or a cloud AI with the warning below.</span></span>
              </label>
            </fieldset>
          )}
          {onPhone && (
            <div className="space-y-1 text-sm">
              <button type="button" onClick={checkPhone} className="text-life-600 hover:underline dark:text-life-200">Check {a.phone.name} is ready</button>
              {phoneState && <p className={phoneState.ready ? 'text-life-700 dark:text-life-200' : 'text-honey-700'} data-phone-state>{phoneState.ready ? `${phoneState.name} is ready.` : phoneState.why}</p>}
            </div>
          )}
          {!onPhone && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="The model's address *"><input required value={form.url} onChange={set('url')} className={inputClass} /></Field>
            <Field label="Model">
              {models?.length ? (
                <select value={form.model} onChange={set('model')} className={inputClass}><option value="">The server's default</option>{models.map((m) => <option key={m}>{m}</option>)}</select>
              ) : <input value={form.model} onChange={set('model')} placeholder="The server's default" className={inputClass} />}
            </Field>
          </div>
          <p className="text-xs text-gray-500 dark:text-life-300">Ollama: http://host.docker.internal:11434/v1. LM Studio: http://host.docker.internal:1234/v1. If Life Is isn't in Docker, use localhost instead of host.docker.internal.</p>
          <button type="button" onClick={look} className="text-sm text-life-600 hover:underline dark:text-life-200">Check it answers, and list its models</button>
          {models && models.length === 0 && <p className="text-sm text-gray-600 dark:text-life-100">It answered, but listed no models.</p>}
          </>}

          <fieldset>
            <legend className="text-sm font-medium text-gray-700 dark:text-life-100">What it may look at</legend>
            <p className="mb-1 text-xs text-gray-500 dark:text-life-300">Only what's checked is sent, and only when you ask. Each answer shows exactly what was sent. Mail, passwords and calendar notes are never sent.</p>
            {AREAS.map(([key, label, what]) => (
              <label key={key} className="flex items-start gap-2 py-1 text-sm text-gray-800 dark:text-life-50">
                <input type="checkbox" checked={form.areas.includes(key)} onChange={() => tick(key)} className="mt-1" />
                <span>{label} <span className="text-xs text-gray-500 dark:text-life-300">— {what}</span></span>
              </label>
            ))}
          </fieldset>

          {!onPhone && <details open={!local || form.cloud_ok} className="rounded-lg border border-honey-200 bg-honey-50 p-3 dark:border-honey-700 dark:bg-transparent">
            <summary className="cursor-pointer text-sm font-medium text-honey-700">A cloud AI instead (off unless you allow it)</summary>
            <p className="mt-2 text-sm text-honey-700">
              A cloud AI (ChatGPT, Claude, Gemini and others) runs on someone else's computers. Whatever you check above, and your question, would leave this computer and be handled under that company's terms,
              which may include keeping it. Life Is can't take it back once sent.
            </p>
            <label className="mt-2 flex items-start gap-2 text-sm text-honey-700">
              <input type="checkbox" checked={form.cloud_ok} onChange={set('cloud_ok')} className="mt-1" />
              <span>Yes, I understand that what I ask about leaves this computer when I use a cloud AI.</span>
            </label>
            <div className="mt-2"><Field label={a.key_saved ? 'Its key (one is saved; leave blank to keep it)' : 'Its key, if it needs one'}><input type="password" autoComplete="off" value={form.key} onChange={set('key')} className={inputClass} /></Field></div>
          </details>}
          {!local && !form.cloud_ok && <p className="text-sm text-red-600">That address isn't on this computer or your own network. Allow a cloud AI above, or use a model at home.</p>}

          {message && <p className="text-sm text-red-600" role="alert">{message}</p>}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className={quietButtonClass}>Not now</button>
            <button type="submit" disabled={busy || (!local && !form.cloud_ok)} className={buttonClass}>{busy ? 'Saving…' : 'Save and turn on'}</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** On the front page, once the assistant is on: ask, read the answer, and see exactly what was sent. */
export function AskCard() {
  const [a, setA] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { axios.get('/api/assistant').then(({ data }) => setA(data)).catch(() => {}); }, []);
  if (!a?.enabled) return null;
  const ask = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setAnswer(null);
    try { setAnswer((await axios.post('/api/assistant/ask', { question })).data); } catch (err) { setError(errorMessage(err, "Couldn't get an answer")); }
    setBusy(false);
  };
  return (
    <section className="rounded-2xl bg-card/90 p-4 shadow-sm ring-1 ring-life-100 dark:bg-life-900/70 dark:ring-life-700" data-ask>
      <form onSubmit={ask} className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Ask about your household" placeholder="Ask about your household…" className={`${inputClass} flex-1`} />
        <button type="submit" disabled={busy || !question.trim()} className={buttonClass}>{busy ? 'Thinking…' : 'Ask'}</button>
      </form>
      <p className="mt-1 text-xs text-gray-500 dark:text-life-300">{a.source === 'phone' ? `Answered by this device's own ${a.phone?.name}; nothing leaves the device.` : a.local ? 'Answered by your own model; nothing leaves home.' : `Answered by a cloud AI at ${new URL(a.url).hostname}: what it looks at leaves this computer.`}</p>
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      {answer && (
        <div className="mt-3 space-y-2">
          <p className="whitespace-pre-wrap text-sm text-gray-800 dark:text-life-50" data-answer>{answer.answer}</p>
          <details className="text-xs text-gray-500 dark:text-life-300">
            <summary className="cursor-pointer">What was sent to the model</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-life-50 p-2 dark:bg-life-800">{JSON.stringify(answer.given, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
