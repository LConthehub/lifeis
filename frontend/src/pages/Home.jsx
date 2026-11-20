import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import Modal, { buttonClass, quietButtonClass, cardClass, fromDateInput, minutesText } from '../components/ui';

const ICONS = { event: '📌', meal: '🍽', session: '🧵', due: '⏳', use_by: '🥫', media: '🎞' };
const TYPE_ICONS = { film: '🎬', show: '📺', music: '🎵', book: '📚', game: '🎮', other: '🗃' };
const STATUS = { active: 'working on it', paused: 'paused', planned: 'planned' };

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const dayName = (day, today) => {
  const n = Math.round((fromDateInput(day) - fromDateInput(today)) / 86400000);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fromDateInput(day).toLocaleDateString(undefined, { weekday: 'long' });
};

function Card({ title, to, link = 'Open', children }) {
  return (
    <section className={cardClass}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{title}</h2>
        {to && <Link to={to} className="text-xs text-life-600 hover:underline dark:text-life-200">{link} →</Link>}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }) => <p className="text-sm text-gray-500 dark:text-life-300">{children}</p>;
const Flag = ({ children }) => <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">{children}</span>;

/** The front page: what today holds and what wants attention, from every section you use. */
export default function Home({ user }) {
  const [s, setS] = useState(null);
  const [choosing, setChoosing] = useState(false);
  const load = useCallback(() => { axios.get('/api/home').then(({ data }) => setS(data)).catch(() => setS(false)); }, []);
  useEffect(() => { load(); }, [load]);
  if (s === null) return null;
  if (s === false) return <Quiet>The front page couldn't be read. Try again in a moment.</Quiet>;
  const shows = (key) => s.cards.includes(key);
  const today = s.day;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{greeting()}, {user.username}</h1>
          <p className="text-sm text-gray-600 dark:text-life-200">{fromDateInput(today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button type="button" onClick={() => setChoosing(true)} className={quietButtonClass}>Choose what shows</button>
      </div>

      {s.cards.length === 0 && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Every card is out of sight. Use "Choose what shows" to bring some back.</div>}

      <div className="grid gap-3 md:grid-cols-2">
        {shows('days') && (
          <Card title="The next three days" to="/calendar" link="Calendar">
            <div className="space-y-3">
              {s.days.map((d) => (
                <div key={d.day}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{dayName(d.day, today)}</h3>
                  {d.entries.length === 0 ? <Quiet>Nothing on.</Quiet> : (
                    <ul className="mt-1 space-y-1">
                      {d.entries.map((e, i) => {
                        const body = (
                          <>
                            <span aria-hidden="true">{ICONS[e.kind]}</span>
                            <span className="flex-1 text-sm text-gray-800 dark:text-life-50">{e.time && <span className="mr-1 font-medium">{e.time}</span>}{e.title}
                              {e.detail && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{e.detail}</span>}</span>
                          </>
                        );
                        return <li key={`${e.kind}-${i}`}>{e.link ? <Link to={e.link} className="flex items-start gap-2 hover:underline">{body}</Link> : <span className="flex items-start gap-2">{body}</span>}</li>;
                      })}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {shows('kitchen') && (
          <Card title="Cooking" to="/week" link="The week">
            {s.kitchen.meals.length === 0 ? <Quiet>No meals planned for today.</Quiet> : (
              <ul className="space-y-1">
                {s.kitchen.meals.map((m) => (
                  <li key={m.id} className="flex items-baseline gap-2 text-sm">
                    <span className="w-20 text-xs capitalize text-gray-500 dark:text-life-300">{m.meal}</span>
                    {m.recipe_id ? <Link to={`/recipes/${m.recipe_id}`} className="flex-1 text-gray-800 hover:underline dark:text-life-50">{m.recipe_title}</Link>
                      : <span className="flex-1 text-gray-800 dark:text-life-50">{m.title}</span>}
                    {m.cooked_on && <span className="text-xs text-gray-400">cooked</span>}
                  </li>
                ))}
              </ul>
            )}
            {s.kitchen.short.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-lg bg-honey-100 px-3 py-2 text-sm text-honey-700">
                {s.kitchen.short.map((x) => (
                  <li key={`${x.day}-${x.meal}-${x.label}`}>{dayName(x.day, today)} {x.meal} needs {x.need} × {x.label}{x.have === null ? ', not in your things' : `; you have ${x.have}`}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-sm">
              <Link to="/groceries" className="text-life-700 hover:underline dark:text-life-100">{s.kitchen.to_buy === 0 ? 'Nothing on the grocery list' : `${s.kitchen.to_buy} to buy on the grocery list`} →</Link>
            </p>
          </Card>
        )}

        {shows('pantry') && (
          <Card title="Pantry" to="/pantry">
            {s.pantry.low.length === 0 && s.pantry.expiring.length === 0 ? <Quiet>Nothing running low, nothing to use up.</Quiet> : (
              <div className="space-y-2 text-sm text-gray-800 dark:text-life-50">
                {s.pantry.expiring.length > 0 && (
                  <p><span className="font-medium">Use soon:</span> {s.pantry.expiring.map((p) => `${p.name} (${p.days_left < 0 ? 'past its date' : p.days_left === 0 ? 'today' : `${p.days_left} days`})`).join(', ')}</p>
                )}
                {s.pantry.low.length > 0 && <p><span className="font-medium">Running low:</span> {s.pantry.low.join(', ')}</p>}
              </div>
            )}
          </Card>
        )}

        {shows('projects') && (
          <Card title="Projects in hand" to="/projects" link="All projects">
            {s.projects.length === 0 ? <Quiet>Nothing in hand. Ideas wait on the projects page.</Quiet> : (
              <ul className="divide-y divide-life-50 dark:divide-life-700">
                {s.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} className="flex items-start gap-2 py-1.5 hover:underline">
                      <span className="flex-1">
                        <span className="block text-sm text-gray-800 dark:text-life-50">{p.name}</span>
                        <span className="block text-xs text-gray-500 dark:text-life-300">{[STATUS[p.status], p.due_on && `wanted by ${p.due_on}`, p.minutes > 0 && minutesText(p.minutes)].filter(Boolean).join(' · ')}</span>
                      </span>
                      {p.short_count > 0 && <Flag>short of {p.short_count}</Flag>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('things') && (
          <Card title="Things" to="/things">
            {s.things.low.length === 0 ? <Quiet>{s.things.total === 0 ? 'Nothing catalogued yet.' : `${s.things.total} things kept, none running low.`}</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.things.low.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2">
                    <span className="flex-1 text-gray-800 dark:text-life-50">{t.name} <span className="text-xs text-gray-500 dark:text-life-300">{t.kind}</span></span>
                    <Flag>low: {t.amount}</Flag>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('collection') && (
          <Card title="Collection" to="/media">
            {s.collection.total === 0 ? <Quiet>Nothing in the collection yet.</Quiet> : (
              <div className="space-y-2 text-sm text-gray-800 dark:text-life-50">
                <p className="text-xs text-gray-500 dark:text-life-300">{s.collection.total} titles{s.collection.wanted ? ` · ${s.collection.wanted} wanted` : ''}</p>
                {s.collection.lent.length > 0 && (
                  <p><span className="font-medium">Lent out:</span> {s.collection.lent.map((l, i) => (
                    <span key={`${l.id}-${l.to}`}>{i > 0 && ', '}<Link to={`/media/${l.id}`} className="hover:underline">{l.title}</Link> (with {l.to})</span>
                  ))}</p>
                )}
                {s.collection.lately.length > 0 && (
                  <ul className="space-y-1">
                    {s.collection.lately.map((t) => (
                      <li key={t.id}><Link to={`/media/${t.id}`} className="hover:underline">{TYPE_ICONS[t.type]} {t.title}</Link> <span className="text-xs text-gray-500 dark:text-life-300">{t.day}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      {choosing && (
        <Modal title="Choose what shows" onClose={() => setChoosing(false)}>
          <CardChooser choices={s.choices} onDone={(data) => { setS(data); setChoosing(false); }} />
        </Modal>
      )}
    </div>
  );
}

function CardChooser({ choices, onDone }) {
  const [shown, setShown] = useState(() => choices.filter((c) => c.shown).map((c) => c.key));
  const toggle = (key) => setShown((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const save = async () => {
    const { data } = await axios.put('/api/home/cards', { hidden: choices.map((c) => c.key).filter((key) => !shown.includes(key)) });
    onDone(data);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-life-100">Untick a card to put it out of sight. Nothing in it is removed.</p>
      <div className="space-y-2">
        {choices.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-life-50">
            <input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} className="mt-0.5 accent-life-600" /> {c.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">Cards only appear for the sections you use. Change those in Settings, under "What Life Is looks after".</p>
      <div className="text-right"><button type="button" onClick={save} className={buttonClass}>Save</button></div>
    </div>
  );
}
