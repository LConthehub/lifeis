import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { quietButtonClass } from './ui';

/**
 * A connected server can be added to Home lab as a link. Only the person in charge adds links, so for anyone else this
 * shows nothing. The button opens the Home lab add form filled in (name, icon, address); the person can change the address
 * before saving. The server's key or password is never part of it, and nothing is sent anywhere.
 */
export function useHomeLab() {
  const [lab, setLab] = useState(null);
  useEffect(() => { axios.get('/api/home-services').then(({ data }) => setLab(data)).catch(() => setLab(null)); }, []);
  return lab;
}

/** The same address, ignoring upper and lower case and a slash on the end. */
export const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase().replace(/\/+$/, '') === b.trim().toLowerCase().replace(/\/+$/, '');

export default function AddToHomeLab({ lab, name, url, icon }) {
  const navigate = useNavigate();
  if (!lab || !lab.can_change) return null;
  const there = lab.services.find((s) => sameAddress(s.address, url) || sameAddress(s.address2, url));
  if (there) {
    return <Link to="/manual/services" className={`${quietButtonClass} inline-flex min-h-[44px] items-center`}>In Home lab</Link>;
  }
  return (
    <button type="button" onClick={() => navigate('/manual/services', { state: { add: { name, address: url, icon } } })} className={`${quietButtonClass} min-h-[44px]`}>
      Add it to Home lab
    </button>
  );
}
