// A stand-in for The Movie Database, for trying films and shows from TMDB. It answers the way the published v3
// API does: /3/configuration, /3/search/movie, /3/search/tv, /3/movie/{id} and /3/tv/{id} (with credits), only to
// the one read access token it is told about (anything else is a 401), and it serves a poster picture under
// /t/p/{size}/{file}. Every request it is asked is kept, with its address and the headers that matter, and read
// back at /log, so a walk-through can check what was, and was not, sent.
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

export const KEY = 'tmdb-stand-in-read-access-token-0123456789';
const asked = [];

// A small picture to serve as a poster: a dark card with a red and a cream band, drawn here as a real PNG.
function poster() {
  const width = 80, height = 120;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const band = y > 28 && y < 44 ? [190, 40, 40] : y > 70 && y < 78 ? [240, 225, 190] : [28, 32, 48 + Math.floor(y / 3)];
      raw.set(band, row + 1 + x * 3);
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const picture = poster();

const alien = {
  id: 348, title: 'Alien', release_date: '1979-05-25', runtime: 117, poster_path: '/alien-poster.jpg',
  overview: 'During its return to the earth, commercial spaceship Nostromo intercepts a distress signal from a distant planet.',
  genres: [{ id: 27, name: 'Horror' }, { id: 878, name: 'Science Fiction' }],
  credits: { crew: [{ job: 'Producer', name: 'Gordon Carroll' }, { job: 'Director', name: 'Ridley Scott' }] },
};
const aliens = { id: 679, title: 'Aliens', release_date: '1986-07-18', poster_path: null, overview: 'Ripley returns.' };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://tmdb');
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (url.pathname === '/log') return json(200, asked);
  if (url.pathname === '/') return json(200, { stand_in: 'tmdb' });
  asked.push({ url: req.url, authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null, referer: req.headers.referer ?? null, headers: Object.keys(req.headers).sort() });
  if (url.pathname.startsWith('/t/p/')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(picture);
  if (req.headers.authorization !== `Bearer ${KEY}` || url.searchParams.has('api_key')) return json(401, { success: false, status_code: 7, status_message: 'Invalid API key: You must be granted a valid key.' });
  if (url.pathname === '/3/configuration') return json(200, { images: { secure_base_url: 'https://image.tmdb.org/t/p/', poster_sizes: ['w92', 'w154', 'w185', 'w342', 'w500', 'w780', 'original'] } });
  if (url.pathname === '/3/search/movie') {
    const q = (url.searchParams.get('query') ?? '').toLowerCase();
    const year = url.searchParams.get('year');
    const all = q.includes('alien') ? [alien, aliens] : [];
    return json(200, { page: 1, results: all.filter((m) => !year || m.release_date.startsWith(year)), total_results: all.length });
  }
  if (url.pathname === '/3/movie/348') return json(200, alien);
  if (url.pathname === '/3/search/tv') return json(200, { page: 1, results: [] });
  return json(404, { success: false, status_code: 34, status_message: 'The resource you requested could not be found.' });
}).listen(8101, '127.0.0.1', () => console.log('stand-in TMDB on 8101'));
