import { useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { Link, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { cardClass } from '../components/ui';
import { DueBadge } from './Upkeep';

/**
 * What you do, and what you do it with: each activity your things are for, or your projects are, with the
 * gear for it and the projects of it. Choosing one shows it on its own.
 */
export default function Activities() {
  const [params, setParams] = useSearchParams();
  const chosen = params.get('name');
  const [all, setAll] = useState(null);
  const [one, setOne] = useState(null);
  const [jobs, setJobs] = useState([]);
  useEffect(() => {
    axios.get('/api/things/activities').then(({ data }) => setAll(data)).catch(() => setAll([]));
    axios.get('/api/things/upkeep').then(({ data }) => setJobs(data)).catch(() => {});
  }, []);
  useEffect(() => {
    setOne(null);
    if (chosen) axios.get('/api/things/activity', { params: { name: chosen } }).then(({ data }) => setOne(data)).catch(() => setOne(false));
  }, [chosen]);
  if (!all) return null;
  const chip = (active) => `rounded-full px-3 py-1 text-sm ${active ? 'bg-life-600 text-white' : 'bg-card text-life-700 ring-1 ring-life-100 hover:bg-life-50 dark:bg-life-800 dark:text-life-100 dark:ring-life-700'}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-life-800 dark:text-life-50">Activities</h1>
      {all.length === 0 ? (
        <div className={`${cardClass} text-sm text-gray-600 dark:text-life-100`}>
          Nothing yet. Say what a thing is for when you change it (the sewing machine is for Sewing; the tent for Camping), or give a project an activity, and it shows up here with its gear.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Activities">
          {all.map((a) => (
            <button key={a.name} type="button" aria-pressed={chosen?.toLowerCase() === a.name.toLowerCase()} onClick={() => setParams({ name: a.name })} className={chip(chosen?.toLowerCase() === a.name.toLowerCase())}>
              {a.name} <span className="opacity-80">{a.things + a.projects + a.jobs}</span>
            </button>
          ))}
        </div>
      )}
      {one && jobs.some((j) => j.activity?.toLowerCase() === one.name.toLowerCase()) && (
        <section className={cardClass} aria-label="Its upkeep">
          <h2 className="mb-1 font-semibold text-life-800 dark:text-life-50">Upkeep for {one.name}</h2>
          <ul className="divide-y divide-life-50 dark:divide-life-700">
            {jobs.filter((j) => j.activity?.toLowerCase() === one.name.toLowerCase()).map((j) => (
              <li key={j.id} className="flex items-center gap-2 py-1.5 text-sm">
                <Link to={`/things/upkeep/${j.id}`} className="flex-1 text-gray-800 hover:underline dark:text-life-50">{j.name}</Link>
                <DueBadge job={j} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {one && (
        <div className="grid gap-3 md:grid-cols-2">
          <section className={cardClass}>
            <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">{one.name}: what it takes <span className="text-sm font-normal text-gray-500 dark:text-life-300">{one.things.length || ''}</span></h2>
            {one.things.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">No things are for this yet.</p> : (
              <ul className="divide-y divide-life-50 dark:divide-life-700">
                {one.things.map((t) => (
                  <li key={t.id} className="py-1.5 text-sm">
                    <Link to={`/things/${t.id}`} className="flex items-baseline gap-2 hover:underline">
                      <span aria-hidden="true">{t.icon}</span>
                      <span className="flex-1 text-gray-800 dark:text-life-50">{t.name}</span>
                      <span className="text-xs text-gray-500 dark:text-life-300">{t.place ? <><Icon of="place" /> {t.place}</> : 'no place'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className={cardClass}>
            <h2 className="mb-2 font-semibold text-life-800 dark:text-life-50">Projects <span className="text-sm font-normal text-gray-500 dark:text-life-300">{one.projects.length || ''}</span></h2>
            {one.projects.length === 0 ? <p className="text-sm text-gray-500 dark:text-life-300">No projects of this yet.</p> : (
              <ul className="space-y-1">
                {one.projects.map((p) => <li key={p.id} className="text-sm"><Link to={`/projects/${p.id}`} className="text-gray-800 hover:underline dark:text-life-50">{p.name}</Link> <span className="text-xs text-gray-500 dark:text-life-300">{p.status}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
