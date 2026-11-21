import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { onDevice } from '../where';

/**
 * On the device, in the parts the one-time unlock covers: says where the free trial stands. Nothing shows in
 * the kitchen (free for good), once unlocked, or anywhere but the app keeping things on the device.
 */
export default function AccessNote({ show, pathname }) {
  const [access, setAccess] = useState(null);
  useEffect(() => {
    if (!onDevice() || !show) return;
    axios.get('/api/access').then(({ data }) => setAccess(data)).catch(() => {});
  }, [show, pathname]);
  if (!onDevice() || !show || !access || access.state === 'unlocked') return null;
  const days = access.days_left;
  const text = access.state === 'ended'
    ? 'The free trial of this part has ended. Everything you entered is still here to read and back up; it can be changed again once Life Is is unlocked.'
    : access.state === 'trial'
      ? `Free to try: ${days} ${days === 1 ? 'day' : 'days'} left for this part of Life Is.`
      : `This part of Life Is is free to try for ${access.trial_days} days, starting when you first add something.`;
  return (
    <p data-access={access.state} className={`mb-3 rounded-lg px-3 py-2 text-sm ${access.state === 'ended' ? 'bg-honey-100 text-honey-700' : 'bg-life-50 text-life-800 dark:bg-life-800 dark:text-life-50'}`}>
      {text} <Link to="/settings#unlock" className="font-medium underline">Unlock for {access.price}, once</Link>
    </p>
  );
}
