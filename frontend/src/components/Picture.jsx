import { useEffect, useState } from 'react';
import axios from 'axios';
import { onDevice } from '../where';

/**
 * A picture Life Is keeps (a plan's photo, a cover). With a server, the browser fetches it by its address
 * like any picture. On the device there is no address to fetch from, so it is asked for the way everything
 * else is, and shown from memory.
 */
export default function Picture({ src, alt = '', ...rest }) {
  const [shown, setShown] = useState(onDevice() ? null : src);
  useEffect(() => {
    if (!onDevice()) { setShown(src); return undefined; }
    let made = null;
    let wanted = true;
    axios.get(src, { responseType: 'arraybuffer' }).then(({ data, headers }) => {
      if (!wanted) return;
      made = URL.createObjectURL(new Blob([data], { type: headers['Content-Type'] || 'image/jpeg' }));
      setShown(made);
    }).catch(() => setShown(null));
    return () => { wanted = false; if (made) URL.revokeObjectURL(made); };
  }, [src]);
  return shown ? <img src={shown} alt={alt} {...rest} /> : <span role="img" aria-label={alt} className={rest.className} />;
}
