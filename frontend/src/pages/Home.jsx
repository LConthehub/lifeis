import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { onDevice } from '../where';
import { AskCard } from '../components/Assistant';
import AskBack from '../components/AskBack';
import { Badge, Open } from '../components/ServiceLinks';
import { StartCard, WeeklyCard, START_CHANGED } from '../components/Start';
import { RoutinesCard } from '../components/Routines';
import HolidayCard from '../components/HolidayCard';
import DontForget from '../components/DontForget';
import Icon, { hasIcon } from '../components/Icon';
import { whoText, whenText } from './Mail';
import { money as moneyText } from '../components/Budget';
import Modal, { buttonClass, quietButtonClass, cardClass, fromDateInput, minutesText, toDateInput, Details, errorDetails } from '../components/ui';

/** A weather mark from the server: an icon where there is one, else the mark as sent. */
const Weather = ({ mark, size }) => (hasIcon(mark) ? <Icon of={mark} size={size} /> : <span aria-hidden="true">{mark}</span>);
const STATUS = { active: 'working on it', paused: 'paused', planned: 'planned' };

function greeting() {
  const hour = new Date().getHours();
  return hour < 5 ? 'Up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

const dayName = (day, today) => {
  const n = Math.round((fromDateInput(day) - fromDateInput(today)) / 86400000);
  return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : fromDateInput(day).toLocaleDateString(undefined, { weekday: 'long' });
};

/** `lead`: the card the person said matters most to them, shown first. */
function Card({ title, to, link = 'Open', lead = false, children }) {
  return (
    <section className={cardClass} style={lead ? { order: -1 } : undefined} data-lead={lead ? 'true' : undefined}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="flex-1 font-semibold text-life-800 dark:text-life-50">{title}</h2>
        {to && <Link to={to} className="text-xs text-life-600 hover:underline dark:text-life-200">{link} →</Link>}
      </div>
      {children}
    </section>
  );
}

const Number = ({ n, label }) => (
  <li className="rounded-lg bg-life-50/70 px-3 py-2 dark:bg-life-700/60">
    <span className="block text-2xl font-semibold text-life-700 dark:text-life-50">{n}</span>
    <span className="block text-xs text-gray-600 dark:text-life-200">{label}</span>
  </li>
);

const inDays = (day, today) => {
  const n = Math.round((fromDateInput(day) - fromDateInput(today)) / 86400000);
  const date = fromDateInput(day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${date} · in ${n} days`;
};

const Quiet = ({ children }) => <p className="text-sm text-gray-500 dark:text-life-300">{children}</p>;
const Flag = ({ children }) => <span className="rounded bg-honey-100 px-1.5 text-[11px] text-honey-700">{children}</span>;

/** The front page: what today holds and what wants attention, from every section you use. */
export default function Home({ user }) {
  const [s, setS] = useState(null);
  const [loadWhy, setLoadWhy] = useState('');
  const [choosing, setChoosing] = useState(false);
  const load = useCallback(() => { axios.get('/api/home').then(({ data }) => setS(data)).catch((err) => { setLoadWhy(errorDetails(err)); setS(false); }); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(START_CHANGED, load);
    return () => window.removeEventListener(START_CHANGED, load);
  }, [load]);
  // The email card's messages come from the mail provider, so they are asked for apart and never hold the page up.
  const [post, setPost] = useState(null);
  // Prep falling due tonight and tomorrow morning ("Thaw the chicken: tonight 8 pm").
  const [prepSoon, setPrepSoon] = useState([]);
  useEffect(() => {
    if (!s) return;
    const next = fromDateInput(s.day);
    next.setDate(next.getDate() + 1);
    const tomorrow = toDateInput(next);
    axios.get('/api/prep/coming', { params: { from: s.day, days: 2 } })
      .then(({ data }) => setPrepSoon(data.filter((p) => p.due_day === s.day || (p.due_day === tomorrow && p.due_time < '12:00'))))
      .catch(() => setPrepSoon([]));
  }, [s]);
  const wantsMail = Boolean(s && s.cards.includes('mail'));
  useEffect(() => { if (wantsMail) axios.get('/api/mail/glance').then(({ data }) => setPost(data)).catch(() => setPost(false)); }, [wantsMail]);
  if (s === null) return null;
  if (s === false) return <div className="text-sm text-gray-500 dark:text-life-300"><p>The front page didn't load. Try again in a moment.</p><Details error={loadWhy} /></div>;
  const shows = (key) => s.cards.includes(key);
  const today = s.day;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="mr-auto">
          <h1 className="text-2xl font-semibold text-life-800 dark:text-life-50">{greeting()}{onDevice() && user.name === user.username ? '' : `, ${user.name ?? user.username}`}</h1>
          <p className="text-sm text-gray-600 dark:text-life-200">{fromDateInput(today).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        </div>
        <button type="button" onClick={() => setChoosing(true)} className={quietButtonClass}>Customize</button>
      </div>

      <StartCard onChanged={load} />
      <WeeklyCard />

      <DontForget cards={s.cards} />

      <AskCard />
      <AskBack />

      {s.cards.length === 0 && <div className={`${cardClass} text-center text-sm text-gray-500 dark:text-life-200`}>Every card is hidden. Tap Customize to bring some back.</div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {shows('days') && (
          <Card title="The next three days" to="/calendar" link="Calendar" lead={s.first === 'days'}>
            <div className="space-y-3">
              {prepSoon.length > 0 && (
                <div data-section="prep-soon">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">Prep</h3>
                  <ul className="mt-1 space-y-1">
                    {prepSoon.map((p) => (
                      <li key={p.key}><Link to="/week" className="flex items-start gap-2 text-sm text-gray-800 hover:underline dark:text-life-50">{p.words}: {p.label}<span className="text-xs text-gray-500 dark:text-life-300">for {p.what}</span></Link></li>
                    ))}
                  </ul>
                </div>
              )}
              {s.days.map((d) => (
                <div key={d.day}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{dayName(d.day, today)}</h3>
                  {d.entries.length === 0 ? <Quiet>Nothing planned.</Quiet> : (
                    <ul className="mt-1 space-y-1">
                      {d.entries.map((e, i) => {
                        const body = (
                          <>
                            <span className="mt-0.5"><Icon of={e.kind} /></span>
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

        {shows('routines') && <RoutinesCard />}

        {shows('weather') && s.weather && (
          <Card title={s.weather.place.name} to="/settings" link="Weather settings">
            {!s.weather.forecast ? <Quiet>The forecast couldn't be fetched just now.</Quiet> : (
              <div className="space-y-3">
                <p className="flex items-center gap-3 text-gray-800 dark:text-life-50">
                  <span className="text-4xl"><Weather mark={s.weather.forecast.now.icon} size={36} /></span>
                  <span className="text-3xl font-semibold">{s.weather.forecast.now.temperature}°</span>
                  <span className="text-sm">{s.weather.forecast.now.words}</span>
                </p>
                <ul className="grid grid-cols-3 gap-2 text-center text-sm">
                  {s.weather.forecast.days.map((d) => (
                    <li key={d.day} className="rounded-lg bg-life-50/70 px-2 py-1.5 dark:bg-life-700/60">
                      <span className="block text-xs font-semibold uppercase tracking-wide text-life-600 dark:text-life-300">{dayName(d.day, today)}</span>
                      <span className="block text-gray-800 dark:text-life-50"><Weather mark={d.icon} /> {d.high}° <span className="text-gray-500 dark:text-life-300">{d.low}°</span></span>
                      <span className="block text-xs text-gray-500 dark:text-life-300">{d.words}{d.wet !== null && d.wet >= 20 ? ` · ${d.wet}%` : ''}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-gray-400 dark:text-life-400">From Open-Meteo, in °{s.weather.place.units.toUpperCase()}</p>
              </div>
            )}
          </Card>
        )}

        {shows('mail') && (
          <Card title="Email" to="/mail" link="Inbox">
            {post === null ? <Quiet>Reading your inbox…</Quiet> : post === false ? <Quiet>Your inbox couldn't be read just now.</Quiet> : (
              <div className="space-y-3">
                {post.map((a) => (
                  <div key={a.id}>
                    <p className="text-xs text-gray-500 dark:text-life-300">{a.address} · {a.problem ? 'couldn’t be read' : a.unread === 0 ? 'nothing unread' : `${a.unread} unread`}</p>
                    {a.problem && <p className="mt-1 rounded-lg bg-honey-100 px-3 py-1.5 text-sm text-honey-700">{a.problem}</p>}
                    {a.newest.length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {a.newest.map((m) => (
                          <li key={m.uid}>
                            <Link to="/mail" className="flex items-baseline gap-2 text-sm hover:underline">
                              <span className="w-28 shrink-0 truncate font-medium text-gray-800 dark:text-life-50">{whoText(m.from)}</span>
                              <span className="min-w-0 flex-1 truncate text-gray-700 dark:text-life-100">{m.subject}</span>
                              <span className="shrink-0 text-xs text-gray-500 dark:text-life-300">{whenText(m.date)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {shows('dates') && (
          <Card title="Coming round" to="/calendar" link="Calendar">
            {s.dates.length === 0 ? <Quiet>No birthdays or yearly dates in the next two months. Add one on the calendar and check "Every year".</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.dates.map((d) => (
                  <li key={`${d.id}-${d.day}`} className="flex items-baseline gap-2">
                    <span className="self-start"><Icon of="birthday" /></span>
                    <span className="flex-1 text-gray-800 dark:text-life-50">{d.title}{d.years > 0 && <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{d.years} {d.years === 1 ? 'year' : 'years'}</span>}</span>
                    <span className="text-xs text-gray-500 dark:text-life-300">{inDays(d.day, today)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('kitchen') && (
          <Card title="Cooking" to="/week" link="The week" lead={s.first === 'kitchen'}>
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
            {s.kitchen.use_up && (
              <p className="mt-3 text-sm">
                <Link to="/pantry" className="text-gray-800 hover:underline dark:text-life-50">
                  Use up soon: {s.kitchen.use_up.soon.join(', ')}.{s.kitchen.use_up.suggestion && ` ${s.kitchen.use_up.suggestion.title} uses ${s.kitchen.use_up.suggestion.uses.join(' and ')}.`}
                </Link>
              </p>
            )}
            <p className="mt-3 text-sm">
              <Link to="/groceries" className="text-life-700 hover:underline dark:text-life-100">{s.kitchen.to_buy === 0 ? 'Nothing on the grocery list' : `${s.kitchen.to_buy} to buy on the grocery list`} →</Link>
            </p>
          </Card>
        )}

        {shows('holidays') && <HolidayCard cards={s.holidays} onChange={load} />}

        {shows('plans') && (
          <Card title="Plans coming up" to="/plans" link="All plans">
            {s.plans.length === 0 ? <Quiet>Nothing planned in the next two months.</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.plans.map((p) => (
                  <li key={p.id}>
                    <Link to={`/plans/${p.id}`} className="flex items-baseline gap-2 hover:underline">
                      <span className="self-start"><Icon of="plan" /></span>
                      <span className="flex-1 text-gray-800 dark:text-life-50">{p.name}</span>
                      <span className="text-xs text-gray-500 dark:text-life-300">{p.days_until === 0 ? (p.end_day === today ? 'today' : 'now') : inDays(p.start_day, today)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('coupons') && (
          <Card title="Coupons about to run out" to="/groceries" link="Groceries">
            {s.coupons.soon.length === 0 ? <Quiet>None run out this week.</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.coupons.soon.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="self-start"><Icon of="coupon" /></span>
                    <span className="flex-1 text-gray-800 dark:text-life-50">{c.label}
                      <span className="ml-2 text-xs text-gray-500 dark:text-life-300">{c.percent_off !== null ? `${c.percent_off}% off` : `${s.coupons.currency}${(c.cents_off / 100).toFixed(2)} off`}{c.store ? ` · ${c.store}` : ''}</span></span>
                    {c.days_left <= 1 ? <Flag>{c.days_left === 0 ? 'last day' : 'tomorrow'}</Flag> : <span className="text-xs text-gray-500 dark:text-life-300">{c.days_left} days left</span>}
                  </li>
                ))}
              </ul>
            )}
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
          <Card title="Projects" to="/projects" link="All projects">
            {s.projects.length === 0 ? <Quiet>Nothing underway. Ideas wait on the projects page.</Quiet> : (
              <ul className="divide-y divide-life-50 dark:divide-life-700">
                {s.projects.map((p) => (
                  <li key={p.id}>
                    <Link to={`/projects/${p.id}`} className="flex items-start gap-2 py-1.5 hover:underline">
                      <span className="flex-1">
                        <span className="block text-sm text-gray-800 dark:text-life-50">{p.name}</span>
                        <span className="block text-xs text-gray-500 dark:text-life-300">{[STATUS[p.status], p.due_on && `wanted by ${p.due_on}`, p.minutes > 0 && minutesText(p.minutes)].filter(Boolean).join(' · ')}</span>
                      </span>
                      {p.short_count > 0 && <Flag>short of {p.short_count}</Flag>}
                      {p.budget?.over > 0 && <Flag>over by {moneyText(p.budget.over, p.budget.currency)}</Flag>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('upkeep') && (
          <Card title="Upkeep" to="/things/upkeep" lead={s.first === 'upkeep'}>
            {s.upkeep.length === 0 ? <Quiet>Nothing due around the home.</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.upkeep.map((j) => (
                  <li key={j.id} className="flex items-baseline gap-2">
                    <Link to={`/things/upkeep/${j.id}`} className="flex-1 text-gray-800 hover:underline dark:text-life-50">{j.name}{j.who && <span className="text-xs text-gray-500 dark:text-life-300"> · {j.who}</span>}</Link>
                    <Flag>{j.state === 'overdue' ? (j.days_left !== null && j.days_left < 0 ? `late ${-j.days_left} d` : 'past due') : j.state === 'due' ? 'today'
                      : j.days_left !== null ? `in ${j.days_left} d` : j.reading_left !== null ? `in ${j.reading_left.toLocaleString()}${j.reading_unit ? ` ${j.reading_unit}` : ''}` : 'soon'}</Flag>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('services') && (
          <Card title="Home lab" to="/manual/services" link="All links">
            {s.services.length === 0 ? <Quiet>Nothing pinned. Pin links on the Home lab page.</Quiet> : (
              <ul className="divide-y divide-life-50 dark:divide-life-700">
                {s.services.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge icon={v.icon} color={v.color} size="h-10 w-10" />
                    <span className="min-w-0 flex-1 basis-32 text-sm text-gray-800 dark:text-life-50">{v.name}{v.group && <span className="block text-xs text-gray-500 dark:text-life-300">{v.group}</span>}</span>
                    <Open service={v} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('things') && (
          <Card title="Things" to="/things" lead={s.first === 'things'}>
            {s.things.low.length === 0 ? <Quiet>{s.things.total === 0 ? 'Nothing cataloged yet.' : `${s.things.total} things kept, none running low.`}</Quiet> : (
              <ul className="space-y-1 text-sm">
                {s.things.low.map((t) => (
                  <li key={t.id} className="flex items-baseline gap-2">
                    <span className="flex-1 text-gray-800 dark:text-life-50"><Link to={`/things/${t.id}`} className="hover:underline">{t.name}</Link> <span className="text-xs text-gray-500 dark:text-life-300">{t.kind}</span></span>
                    <Flag>low: {t.amount}</Flag>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {shows('things') && s.ammo?.length > 0 && (
          <Card title="Ammunition running low" to="/things">
            <ul className="space-y-1 text-sm">
              {s.ammo.map((t) => (
                <li key={t.id} className="flex items-baseline gap-2">
                  <span className="flex-1 text-gray-800 dark:text-life-50"><Link to={`/things/${t.id}`} className="hover:underline">{t.name}</Link>{t.caliber && <span className="text-xs text-gray-500 dark:text-life-300"> {t.caliber}</span>}</span>
                  <Flag>low: {t.amount}</Flag>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-gray-500 dark:text-life-300">Only you see this.</p>
          </Card>
        )}

        {shows('collection') && (
          <Card title="Collection" to="/media">
            {s.collection.total === 0 ? <Quiet>Nothing in the collection yet.</Quiet> : (
              <div className="space-y-2 text-sm text-gray-800 dark:text-life-50">
                <p className="text-xs text-gray-500 dark:text-life-300">{s.collection.total} titles{s.collection.wanted ? ` · ${s.collection.wanted} wanted` : ''}</p>
                {s.collection.added?.length > 0 && (
                  <div data-new-titles>
                    <p className="font-medium">New</p>
                    <ul className="mt-1 flex w-0 min-w-full gap-2 overflow-x-auto pb-1" aria-label="New in the collection">
                      {s.collection.added.map((t) => (
                        <li key={t.id} className="w-16 flex-none">
                          <Link to={`/media/${t.id}`} className="block" aria-label={t.title}>
                            {typeof t.cover === 'string' && t.cover.startsWith('/api/')
                              ? <img src={t.cover} alt="" loading="lazy" className="h-24 w-16 rounded object-cover" />
                              : <span aria-hidden="true" className="flex h-24 w-16 items-center justify-center rounded bg-life-50 dark:bg-life-700"><Icon of={t.type} size={24} /></span>}
                            <span className="mt-1 block max-h-[2.5em] overflow-hidden break-words text-[11px] leading-tight text-gray-700 dark:text-life-100">{t.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {s.collection.added_count > s.collection.added.length && (
                      <Link to="/media?sort=added" className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">and {s.collection.added_count - s.collection.added.length} more</Link>
                    )}
                  </div>
                )}
                {s.collection.lent.length > 0 && (
                  <p><span className="font-medium">Lent out:</span> {s.collection.lent.map((l, i) => (
                    <span key={`${l.id}-${l.to}`}>{i > 0 && ', '}<Link to={`/media/${l.id}`} className="hover:underline">{l.title}</Link> (with {l.to})</span>
                  ))}</p>
                )}
                {s.collection.lately.length > 0 && (
                  <ul className="space-y-1">
                    {s.collection.lately.map((t) => (
                      <li key={t.id}><Link to={`/media/${t.id}`} className="hover:underline"><Icon of={t.type} /> {t.title}</Link> <span className="text-xs text-gray-500 dark:text-life-300">{t.day}</span></li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        )}

        {shows('week') && (
          <Card title="This week in numbers">
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {s.week.events !== null && <Number n={s.week.events} label={s.week.events === 1 ? 'thing on the calendar' : 'things on the calendar'} />}
              {s.week.meals_planned !== null && <Number n={s.week.meals_planned} label={s.week.meals_planned === 1 ? 'meal planned' : 'meals planned'} />}
              {s.week.meals_cooked !== null && <Number n={s.week.meals_cooked} label="cooked so far" />}
              {s.week.minutes !== null && <Number n={s.week.minutes === 0 ? '0' : minutesText(s.week.minutes)} label={`on projects, over ${s.week.sessions} ${s.week.sessions === 1 ? 'sitting' : 'sittings'}`} />}
              {s.week.enjoyed !== null && <Number n={s.week.enjoyed} label="watched, read or heard" />}
            </ul>
            <p className="mt-2 text-[11px] text-gray-400 dark:text-life-400">Monday {fromDateInput(s.week.start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} to Sunday {fromDateInput(s.week.end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</p>
          </Card>
        )}
      </div>

      {choosing && (
        <Modal title="Customize Home" onClose={() => setChoosing(false)}>
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
      <p className="text-sm text-gray-600 dark:text-life-100">Uncheck a card to hide it. Nothing in it is deleted.</p>
      <div className="space-y-2">
        {choices.map((c) => (
          <label key={c.key} className="flex cursor-pointer items-start gap-2 text-sm text-gray-800 dark:text-life-50">
            <input type="checkbox" checked={shown.includes(c.key)} onChange={() => toggle(c.key)} className="mt-0.5 accent-life-600" /> {c.label}
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-life-300">Cards only appear for the sections you use. Change those in Settings, under "What Life Is looks after". The weather and email are outside services: turn them on in Settings, under "Connections".</p>
      <div className="text-right"><button type="button" onClick={save} className={buttonClass}>Save</button></div>
    </div>
  );
}
