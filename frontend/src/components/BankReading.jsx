import { useEffect, useState } from 'react';
import axios from 'axios';
import { OnOffBox, ForgetIt } from './OnOff';
import Icon from './Icon';
import { Field, inputClass, buttonClass, quietButtonClass, errorMessage } from './ui';
import { onDevice } from '../where';

// Reading bank accounts through SimpleFIN is offered only on a Life Is the person hosts themselves: in a browser,
// or in the phone app signed in to it. Never in the phone app keeping everything on the phone. The private
// address SimpleFIN gives is kept locked on the computer that runs Life Is, and a phone keeping its own data has
// no such place; the CSV statement import (under Spending) works there instead.
const touch = 'min-h-[44px]';
const dollars = (cents, currency) => (cents == null ? '' : `${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`);
const stamped = (at) => (at ? new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
const ago = (days) => { const d = new Date(); d.setDate(d.getDate() - days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Settings > Connections: bring spending in from bank accounts, read only. What is sent is said before it is turned on. */
export function BankReadingService() {
  const [s, setS] = useState(null);
  const [categories, setCategories] = useState([]);
  const [token, setToken] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ text: '', bad: false });
  const [result, setResult] = useState(null);
  const away = onDevice();

  useEffect(() => {
    if (away) return;
    axios.get('/api/money/simplefin').then(({ data }) => { setS(data); setFrom(ago(data.default_days)); }).catch(() => {});
    axios.get('/api/money').then(({ data }) => setCategories(data.categories ?? [])).catch(() => {});
  }, [away]);

  if (away) {
    return (
      <div className="py-3" data-bank>
        <h3 className="font-medium text-gray-800 dark:text-life-50"><Icon of="bank" /> Read your bank accounts (SimpleFIN)</h3>
        <p className="mt-1 text-sm text-gray-600 dark:text-life-100" data-bank-why>
          This is not offered in the app while it keeps everything on this phone. The private address that SimpleFIN gives you is kept locked on the computer that runs Life Is, and a phone keeping its own data has no such place to hold it.
          To use it, run Life Is on a computer of your own and sign in to it from this app. Meanwhile, you can still bring in the statement file your bank offers, under Spending.
        </p>
      </div>
    );
  }
  if (!s) return null;

  const run = async (work, { done, keepResult = false } = {}) => {
    setBusy(true); setMessage({ text: '', bad: false });
    if (!keepResult) setResult(null);
    try { const out = await work(); if (done) setMessage({ text: done, bad: false }); return out; } catch (err) { setMessage({ text: errorMessage(err, "Couldn't do that"), bad: true }); return null; } finally { setBusy(false); }
  };
  const turn = (on) => run(async () => { const { data } = await axios.put('/api/money/simplefin', { on }); setS(data); });
  const connect = (e) => {
    e.preventDefault();
    return run(async () => {
      const { data } = await axios.post('/api/money/simplefin/connect', { token });
      setToken(''); setS(data);
      setMessage({ text: data.problem ? `Connected. The list of accounts couldn't be read just now: ${data.problem}` : 'Connected. Choose the accounts to bring in.', bad: Boolean(data.problem) });
    });
  };
  const change = (id, patch) => setS({ ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const save = () => run(async () => {
    const { data } = await axios.put('/api/money/simplefin/accounts', { accounts: s.accounts.map((a) => ({ id: a.id, chosen: a.chosen, category_id: a.category_id })) });
    setS(data);
  }, { done: 'Saved.' });
  const refresh = () => run(async () => {
    const { data } = await axios.post('/api/money/simplefin/refresh');
    setS(data);
    setMessage({ text: data.errors?.length ? data.errors.join(' ') : 'The list of accounts is up to date.', bad: Boolean(data.errors?.length) });
  });
  const readNow = () => run(async () => {
    await axios.put('/api/money/simplefin/accounts', { accounts: s.accounts.map((a) => ({ id: a.id, chosen: a.chosen, category_id: a.category_id })) });
    const { data } = await axios.post('/api/money/simplefin/read', { from_day: from, minutes_behind_utc: new Date().getTimezoneOffset() });
    setS(data.state); setResult(data);
  }, { keepResult: true });
  const disconnect = () => {
    if (!window.confirm('Disconnect SimpleFIN? The locked access address and your choice of accounts are forgotten. Spending already brought in stays.')) return;
    run(async () => { const { data } = await axios.delete('/api/money/simplefin'); setS(data); }, { done: 'Disconnected.' });
  };

  const c = s.connection;
  const chosen = s.accounts.filter((a) => a.chosen).length;
  return (
    <div className="py-3" data-bank>
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50"><Icon of="bank" /> Read your bank accounts (SimpleFIN)</h3>
        <span className={`rounded px-1.5 text-[11px] ${s.on && c ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{s.on && c ? 'On' : 'Off'}</span>
      </div>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">
        Bring what you spent into Life Is straight from your bank accounts, so you don't type it or download a file. It is read only. It goes through <a href={s.service.site} target="_blank" rel="noreferrer" className="underline">SimpleFIN</a>, a service you sign up for yourself at <a href={s.service.bridge} target="_blank" rel="noreferrer" className="underline">the SimpleFIN Bridge</a>; see those pages for what it costs and which banks it reaches.
        {' '}<span className="font-medium">What it's sent:</span> <span data-bank-sends>{s.service.sends}</span>
      </p>
      <p className="mt-1 text-sm text-gray-600 dark:text-life-100">The private access address SimpleFIN gives is kept locked on this computer. It is never shown again, to you or to this page, and it is not in your downloads.</p>
      {!s.available ? <p className="mt-2 text-sm text-gray-500 dark:text-life-300">This copy of Life Is isn't set up to reach outside, so this can't be turned on.</p> : <>
      <OnOffBox name="bank-on" label="Turn on bank reading" checked={s.on} disabled={busy} onChange={turn} />
      {!s.on && c && <p className="text-sm text-gray-700 dark:text-life-100" data-bank-kept>Your connection to {c.host} is kept for later, and nothing is read. <ForgetIt onForget={disconnect} /></p>}
      {!s.on ? null : (
        <div className="mt-3 space-y-3">
          {!c ? (
            <form onSubmit={connect} className="space-y-2" data-bank-connect>
              <Field label="SimpleFIN setup token">
                <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={`${inputClass} ${touch}`} />
              </Field>
              <p className="text-xs text-gray-500 dark:text-life-300">Make a setup token in your SimpleFIN Bridge account and paste it here. A token works once: Life Is uses it to claim the access address, and then forgets it.</p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || !token.trim()} className={`${buttonClass} ${touch}`}>Connect</button>
              </div>
            </form>
          ) : (
            <>
              <p className="text-sm text-gray-700 dark:text-life-100" data-bank-connected>
                Connected to <span className="font-medium">{c.host}</span> on {stamped(c.connected_at)}.{c.last_read_at ? ` Last read ${stamped(c.last_read_at)}.` : ' Not read yet.'}
              </p>
              {s.accounts.length === 0 ? <p className="text-sm text-gray-600 dark:text-life-100">No accounts are listed yet. Look for them below.</p> : (
                <ul className="divide-y divide-life-100 dark:divide-life-700" data-bank-accounts>
                  {s.accounts.map((a) => (
                    <li key={a.id} className="space-y-2 py-2">
                      <label className={`flex items-start gap-3 ${touch}`}>
                        <input type="checkbox" checked={a.chosen} onChange={(e) => change(a.id, { chosen: e.target.checked })} className="mt-1 h-5 w-5 accent-life-600" />
                        <span className="text-sm">
                          <span className="font-medium text-gray-800 dark:text-life-50">{a.name}</span>
                          <span className="block text-xs text-gray-500 dark:text-life-300">{[a.org, dollars(a.balance_cents, a.currency) && `balance ${dollars(a.balance_cents, a.currency)}`].filter(Boolean).join(' · ')}</span>
                        </span>
                      </label>
                      {a.chosen && (
                        <Field label="Put its spending in the category">
                          <select value={a.category_id ?? ''} onChange={(e) => change(a.id, { category_id: e.target.value ? Number(e.target.value) : null })} className={`${inputClass} ${touch}`}>
                            <option value="">None. I will sort it later.</option>
                            {categories.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                          </select>
                        </Field>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || s.accounts.length === 0} onClick={save} className={`${quietButtonClass} ${touch}`}>Save my choices</button>
                <button type="button" disabled={busy} onClick={refresh} className={`${quietButtonClass} ${touch}`}>Look for accounts again</button>
              </div>
              <div className="space-y-2 rounded-xl bg-life-50 p-3 dark:bg-life-700/40" data-bank-read>
                <Field label={`Read from this day (up to ${s.max_days} days back)`}>
                  <input type="date" value={from} min={ago(s.max_days)} max={ago(0)} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} ${touch}`} />
                </Field>
                <button type="button" disabled={busy || chosen === 0 || !from} onClick={readNow} className={`${buttonClass} ${touch}`}>Read now</button>
                <p className="text-xs text-gray-500 dark:text-life-300">{chosen === 0 ? 'Check at least one account first. ' : ''}Nothing is read by itself: SimpleFIN limits how often an account may be read, so Life Is reads only when you press this. Money out that has settled becomes spending. Money in, and what is still pending, is left out.</p>
              </div>
              <button type="button" disabled={busy} onClick={disconnect} className={`${quietButtonClass} ${touch}`}>Disconnect</button>
            </>
          )}
        </div>
      )}
      </>}
      {message.text && <p role="status" className={`mt-2 text-sm ${message.bad ? 'text-red-600' : 'text-gray-700 dark:text-life-100'}`}>{message.text}</p>}
      {result && (
        <div className="mt-3 space-y-2 rounded-xl bg-life-50 p-3 text-sm text-life-800 dark:bg-life-700 dark:text-life-50" data-bank-result>
          <p>
            Read from {result.from_day}: <span className="font-medium">{result.added} added</span>, {result.already} already there, {result.left_out} left out.
            {result.left_out > 0 && ` (${[result.money_in && `${result.money_in} money in`, result.pending && `${result.pending} still pending`, result.other && `${result.other} with no amount`].filter(Boolean).join(', ')}.)`}
          </p>
          {result.months.length > 0 && <p>Added to {result.months.map((m) => `${m.month} (${m.added})`).join(', ')}. Find them under Spending.</p>}
          {result.errors.length > 0 && (
            <div data-bank-errors>
              <p className="font-medium">SimpleFIN says:</p>
              <ul className="list-disc pl-5">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
