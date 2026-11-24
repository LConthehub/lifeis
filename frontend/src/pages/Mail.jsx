import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import axios from 'axios';
import Modal, { Field, inputClass, buttonClass, quietButtonClass, cardClass, errorMessage } from '../components/ui';

export const whoText = (who) => (who ? who.name || who.address : 'Unknown sender');
export const whenText = (iso) => {
  if (!iso) return '';
  const at = new Date(iso);
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** Your inbox, read from your mail provider as you look. Nothing here is kept by Life Is. */
export default function Mail() {
  const [setup, setSetup] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    axios.get('/api/mail').then(({ data }) => { setSetup(data); if (data.accounts[0]) setAccountId(data.accounts[0].id); }).catch(() => setSetup(false));
  }, []);
  const load = useCallback(() => {
    if (!accountId) return;
    setInbox(null); setError('');
    axios.get(`/api/mail/accounts/${accountId}/messages`).then(({ data }) => setInbox(data)).catch((err) => { setInbox({ messages: [], unread: 0 }); setError(errorMessage(err, "The inbox couldn't be read")); });
  }, [accountId]);
  useEffect(() => { load(); }, [load]);

  if (setup === null) return null;
  if (setup === false) return <p className="text-sm text-gray-500 dark:text-life-300">Mail couldn't be read. Try again in a moment.</p>;
  if (setup.accounts.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Mail</h1>
        <div className={`${cardClass} space-y-2 text-sm text-gray-700 dark:text-life-100`}>
          <p>Email is optional and off. If you'd like your inbox here, to read and answer, add an account in Settings.</p>
          <p className="text-gray-500 dark:text-life-300">{setup.service.sends}</p>
          <Link to="/settings" className={`${buttonClass} inline-block`}>Set up email in Settings</Link>
        </div>
      </div>
    );
  }
  const account = setup.accounts.find((a) => a.id === accountId);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold text-life-800 dark:text-life-50">Inbox{inbox && inbox.unread > 0 && <span className="ml-2 text-sm font-normal text-gray-500 dark:text-life-300">{inbox.unread} unread</span>}</h1>
        {setup.accounts.length > 1 && (
          <select aria-label="Account" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))} className={`${inputClass} !w-auto`}>
            {setup.accounts.map((a) => <option key={a.id} value={a.id}>{a.address}</option>)}
          </select>
        )}
        <button type="button" onClick={load} className={quietButtonClass}>Check again</button>
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">{account?.address} · read from your mail provider just now, not kept here. Opening a message doesn't mark it read.</p>
      {error && <p className="rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">{error}</p>}
      {inbox === null ? <p className="text-sm text-gray-500 dark:text-life-300">Reading your inbox…</p> : inbox.messages.length === 0 && !error ? <p className="text-sm text-gray-500 dark:text-life-300">The inbox is empty.</p> : (
        <ul className={`${cardClass} divide-y divide-life-50 !p-0 dark:divide-life-700`}>
          {inbox.messages.map((m) => (
            <li key={m.uid}>
              <button type="button" onClick={() => setOpen(m.uid)} className="flex w-full items-baseline gap-3 px-4 py-2.5 text-left hover:bg-life-50 dark:hover:bg-life-700">
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 self-center rounded-full ${m.unread ? 'bg-coral' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${m.unread ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-life-100'}`}>{whoText(m.from)}{m.unread && <span className="sr-only"> (unread)</span>}</span>
                  <span className={`block truncate text-sm ${m.unread ? 'text-gray-800 dark:text-life-50' : 'text-gray-500 dark:text-life-300'}`}>{m.flagged && <><Icon of="flag" size={14} /> </>}{m.subject}</span>
                </span>
                <span className="shrink-0 text-xs text-gray-500 dark:text-life-300">{whenText(m.date)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && (
        <Modal title="Message" onClose={() => { setOpen(null); }}>
          <Message accountId={accountId} uid={open} onChanged={load} />
        </Modal>
      )}
    </div>
  );
}

function Message({ accountId, uid, onChanged }) {
  const [m, setM] = useState(null);
  const [error, setError] = useState('');
  const [replying, setReplying] = useState(null);   // null, 'one' or 'all'
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);
  const base = `/api/mail/accounts/${accountId}/messages/${uid}`;
  useEffect(() => { axios.get(base).then(({ data }) => setM(data)).catch((err) => setError(errorMessage(err, "That message couldn't be read"))); }, [base]);
  if (error && !m) return <p className="text-sm text-red-600">{error}</p>;
  if (!m) return <p className="text-sm text-gray-500 dark:text-life-300">Reading…</p>;

  const mark = async (seen) => {
    try { await axios.put(`${base}/seen`, { seen }); setM({ ...m, unread: !seen }); onChanged(); } catch (err) { setError(errorMessage(err, "Couldn't change that")); }
  };
  const send = async (e) => {
    e.preventDefault();
    setSending(true); setError('');
    try {
      const { data } = await axios.post(`${base}/reply`, { text, all: replying === 'all' });
      setSent(data); setReplying(null); setText(''); onChanged();
    } catch (err) { setError(errorMessage(err, "Couldn't send it")); }
    setSending(false);
  };
  const others = m.to.length + m.cc.length > 1;
  const list = (people) => people.map((w) => (w.name ? `${w.name} <${w.address}>` : w.address)).join(', ');
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-life-800 dark:text-life-50">{m.subject}</h3>
        <p className="text-sm text-gray-700 dark:text-life-100">From {m.from ? list([m.from]) : 'an unknown sender'}</p>
        <p className="text-xs text-gray-500 dark:text-life-300">To {list(m.to) || 'nobody named'}{m.cc.length > 0 && ` · Cc ${list(m.cc)}`}{m.date && ` · ${new Date(m.date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}</p>
      </div>
      <div className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-life-50/60 p-3 text-sm text-gray-800 dark:bg-life-800 dark:text-life-50">{m.text || 'This message has no words in it.'}</div>
      {m.attachments.length > 0 && <p className="text-xs text-gray-500 dark:text-life-300"><Icon of="attachment" size={14} /> {m.attachments.join(', ')}. Attachments stay with your mail provider; open them in your mail program.</p>}
      {sent && <p className="rounded-lg bg-life-100 px-3 py-2 text-sm text-life-800">Sent to {list([...sent.to, ...sent.cc])}.</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {replying ? (
        <form onSubmit={send} className="space-y-2">
          <Field label={`Your reply${replying === 'all' ? ' to everyone' : ` to ${whoText(m.reply_to || m.from)}`} (their message is quoted beneath it)`}>
            <textarea required autoFocus rows={6} value={text} onChange={(e) => setText(e.target.value)} className={inputClass} />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setReplying(null)} className={quietButtonClass}>Not now</button>
            <button type="submit" disabled={sending} className={buttonClass}>{sending ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => mark(m.unread)} className={quietButtonClass}>{m.unread ? 'Mark as read' : 'Mark as unread'}</button>
          <span className="flex-1" />
          {others && <button type="button" onClick={() => { setReplying('all'); setSent(null); }} className={quietButtonClass}>Reply to everyone</button>}
          <button type="button" onClick={() => { setReplying('one'); setSent(null); }} className={buttonClass}>Reply</button>
        </div>
      )}
    </div>
  );
}
