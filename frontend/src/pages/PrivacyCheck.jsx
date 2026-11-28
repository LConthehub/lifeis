import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { cardClass } from '../components/ui';
import { inApp, onDevice } from '../where';

// The privacy check-up: one short checklist of what other people could see. It only reads what Life Is already
// knows. Every line has a link to the switch that changes it, and nothing here changes anything by itself.

const get = (address) => axios.get(address).then(({ data }) => data).catch(() => null);
const IDLE_WORDS = { 5: '5 minutes', 15: '15 minutes', 30: '30 minutes', 60: '1 hour', 120: '2 hours', 480: '8 hours' };
const dayWords = (value) => {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function Line({ on, title, children, to, change }) {
  return (
    <li className="space-y-1 py-3" data-line>
      <div className="flex items-baseline gap-2">
        <h3 className="flex-1 font-medium text-gray-800 dark:text-life-50">{title}</h3>
        {on !== undefined && <span className={`rounded px-1.5 text-[11px] ${on ? 'bg-life-100 text-life-700' : 'bg-gray-100 text-gray-600'}`}>{on ? 'On' : 'Off'}</span>}
      </div>
      <div className="space-y-1 text-sm text-gray-700 dark:text-life-100">{children}</div>
      {to && <Link to={to} className="inline-flex min-h-[44px] items-center text-sm text-life-600 underline dark:text-life-200">{change}</Link>}
    </li>
  );
}

function Part({ id, title, children }) {
  return (
    <section className={cardClass} data-part={id} aria-labelledby={`part-${id}`}>
      <h2 id={`part-${id}`} className="font-semibold text-life-800 dark:text-life-50">{title}</h2>
      <ul className="mt-1 divide-y divide-life-100 dark:divide-life-700">{children}</ul>
    </section>
  );
}

/** Every outside connection that is on, with what it sends, and a count of the ones that are off. */
function connectionsFrom({ weather, mail, lookups, photos, bank, recalls, assistant, calendars, connector, paused }) {
  const rows = [];
  const add = (id, name, on, sends, to) => rows.push({ id, name, on, sends, to });
  if (weather) add('weather', 'Weather', Boolean(weather.place), weather.service?.sends, '/settings/connections#weather');
  if (mail) add('mail', 'Email', mail.accounts.length > 0 && !paused?.mail, mail.service?.sends, '/settings/connections#mail');
  if (lookups) {
    add('lookups', 'Grocery lookups', Boolean(lookups.groceries), lookups.grocery_service?.sends, '/settings/connections#lookups');
    add('lookups', 'Book lookups', Boolean(lookups.books), lookups.service?.sends, '/settings/connections#lookups');
    add('lookups', 'Film, music and game lookups', Boolean(lookups.titles), lookups.title_services?.sends, '/settings/connections#lookups');
    if (lookups.film_service) add('lookups', 'TMDB film lookups', Boolean(lookups.films), lookups.film_service.sends, '/settings/connections#lookups');
  }
  if (photos) add('photos', 'Photos from Immich', photos.connected && !paused?.photos, photos.service?.sends, '/settings/connections#photos');
  if (bank) add('bank', 'Bank accounts (SimpleFIN)', Boolean(bank.on && bank.connection), bank.service?.sends, '/settings/connections#bank');
  if (recalls) add('recalls', 'Recall alerts', Boolean(recalls.on), recalls.service?.sends, '/settings/connections#recalls');
  if (calendars) add('other-calendars', 'Other calendars', calendars.calendars.length > 0 && !paused?.calendars, calendars.service?.sends, '/settings/calendars#other-calendars');
  if (assistant) add('assistant', 'AI assistant', Boolean(assistant.enabled), assistant.service?.sends, '/settings/connections#assistant');
  if (connector && connector.available !== false) add('ai-apps', 'Use Life Is from your AI app', Boolean(connector.household_on), connector.service?.sends, '/settings/connections#ai-apps');
  return rows;
}

export default function PrivacyCheck() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let live = true;
    Promise.all([
      get('/api/manual'), get('/api/privacy/people'), get('/api/account'), get('/api/reminders'), get('/api/paused'),
      get('/api/weather'), get('/api/mail'), get('/api/lookups'), get('/api/photos'), get('/api/money/simplefin'),
      get('/api/recalls'), get('/api/assistant'), get('/api/calendar/others'), get('/api/connector'),
    ]).then(([manual, people, account, reminders, paused, weather, mail, lookups, photos, bank, recalls, assistant, calendars, connector]) => {
      if (live) setData({ manual, people, account, reminders, paused, weather, mail, lookups, photos, bank, recalls, assistant, calendars, connector });
    });
    return () => { live = false; };
  }, []);

  if (!data) return <p className="text-sm text-gray-600 dark:text-life-200" role="status">Checking…</p>;
  const { manual, people, account, reminders, paused } = data;
  const share = manual?.share;
  const connections = connectionsFrom({ ...data, paused });
  const open = connections.filter((c) => c.on);
  // The AI parts stay out of sight until they are on, as they do in Settings.
  const closed = connections.filter((c) => !c.on && !['assistant', 'ai-apps'].includes(c.id));
  const ways = reminders?.settings;

  return (
    <div className="space-y-4" data-privacy-check>
      <div>
        <Link to="/settings" className="inline-flex min-h-[44px] items-center text-sm text-life-600 hover:underline dark:text-life-200">‹ Settings</Link>
        <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Privacy check-up</h1>
        <p className="text-sm text-gray-600 dark:text-life-200">What other people could see. This page only reads. Each line has a link to the switch that changes it.</p>
      </div>

      <Part id="guest" title="What a guest sees">
        <Line on={Boolean(share?.on)} title="The house manual link" to="/manual" change="Change it in the house manual">
          {share?.on
            ? <p>Anyone who has the link can read the manual without signing in{share.expires_on ? `, until ${dayWords(share.expires_on)}` : ', with no end day'}. {share.pets ? 'It includes your pets.' : 'It leaves your pets out.'} Entries marked private are never shown.</p>
            : <p>No link is on, so a guest sees nothing of your Life Is.</p>}
        </Line>
      </Part>

      {people && (
        <Part id="people" title="What the other people who sign in see">
          {people.others === 0 ? (
            <Line title="Nobody else signs in here">
              <p>Only you have an account, so nothing here is seen by anyone else.</p>
            </Line>
          ) : (
            <>
              <Line title="Your lists" to="/media/lists" change="Change who sees a list">
                <p>{people.shared_lists.length ? `Shared with everyone who signs in: ${people.shared_lists.join(', ')}.` : 'None of your lists is shared.'}</p>
              </Line>
              <Line title="Your spending categories" to="/money" change="Change who sees a category">
                <p>{people.shared_categories.length ? `Shared by name: ${people.shared_categories.map((c) => `${c.name} (${plural(c.people, 'person', 'people')})`).join(', ')}.` : 'None of your categories is shared.'}</p>
              </Line>
              <Line title="Things kept private" to="/things" change="Change who sees a thing">
                <p>{people.shared_private_things ? `${plural(people.shared_private_things, 'private thing is', 'private things are')} shared with people you chose.` : 'No private thing is shared.'}</p>
              </Line>
              <Line title="Trips" to="/plans/trips" change="Change a trip">
                <p>{people.shared_trips.length ? `Other people see the name and days of: ${people.shared_trips.join(', ')}.` : 'No trip is shared.'}{people.private_trips ? ` ${plural(people.private_trips, 'trip is', 'trips are')} marked private.` : ''}</p>
              </Line>
              <Line title="Everything else" to="/settings/account#people" change="See who has an account">
                <p>{plural(people.others, 'other person signs', 'other people sign')} in here. Things you keep, recipes, the pantry and the calendar are in the same household.</p>
              </Line>
            </>
          )}
        </Part>
      )}

      <Part id="screen" title="What shows when the app is left open">
        {onDevice() ? (
          <Line title="This device">
            <p>Life Is on this device has no sign-in of its own. The phone's own screen lock is what keeps others out.</p>
          </Line>
        ) : (
          <Line title="Signing out by itself" to="/settings/account#idle" change="Change the sign-out time">
            {!account ? <p>Couldn't read this just now.</p>
              : account.idle_minutes === 0 ? <p>Never. Whatever page is on the screen stays there until someone closes it.</p>
                : <p>After {IDLE_WORDS[account.idle_minutes] ?? `${account.idle_minutes} minutes`} without use. Until then, the page on the screen stays readable.</p>}
          </Line>
        )}
      </Part>

      <Part id="reminders" title="What reminders show on a locked phone">
        {!ways ? <Line title="Reminders"><p>Couldn't read this just now.</p></Line> : (
          <>
            {inApp() && (
              <Line on={ways.phone} title="On this phone" to="/settings/reminders" change="Change it in Reminders">
                <p>{ways.phone ? "Each morning's reminder shows the words of what is due, such as the name of a thing. Anyone who sees the lock screen can read them." : 'Off. Nothing is shown.'}</p>
              </Line>
            )}
            {reminders.can?.push && (
              <Line on={ways.push} title="This browser, and others you allow" to="/settings/reminders" change="Change it in Reminders">
                <p>{ways.push ? reminders.services?.push?.sends : 'Off. Nothing is shown.'}</p>
              </Line>
            )}
            {reminders.can?.ntfy && (
              <Line on={Boolean(ways.ntfy)} title="ntfy" to="/settings/reminders" change="Change it in Reminders">
                <p>{ways.ntfy ? (ways.ntfy.detail === 'full' ? 'Says what each thing is, so it can be read on a locked phone.' : 'Says only how many things are due.') : 'Off. Nothing is shown.'}</p>
              </Line>
            )}
            {reminders.can?.mail_available && (
              <Line on={ways.email} title="Email" to="/settings/reminders" change="Change it in Reminders">
                <p>{ways.email ? 'Sent to your own address. A locked phone shows whatever its mail app shows for a new message.' : 'Off. Nothing is sent.'}</p>
              </Line>
            )}
          </>
        )}
      </Part>

      <Part id="connections" title="Which outside connections are on">
        {open.length === 0 && <Line title="None"><p>Nothing is on, so Life Is sends nothing outside.</p></Line>}
        {open.map((c) => (
          <Line key={c.name} on title={c.name} to={c.to} change={`Change ${c.name.toLowerCase()}`}>
            <p><span className="font-medium">What it sends:</span> {c.sends}</p>
          </Line>
        ))}
        {closed.length > 0 && (
          <Line title={`Off: ${closed.length}`} to="/settings/connections" change="See them in Connections">
            <p>{closed.map((c) => c.name).join(', ')}. Nothing is sent for these.</p>
          </Line>
        )}
      </Part>
    </div>
  );
}
