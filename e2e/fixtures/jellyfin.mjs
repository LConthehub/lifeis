// A stand-in Jellyfin for trying the Servers page: a handful of titles, a key, and a cover picture.
import { createServer } from 'node:http';

const KEY = 'trial-jellyfin-key';
// A real, tiny PNG: one sage-green pixel.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkmPe/HgAEYgIA1m0kXwAAAABJRU5ErkJggg==', 'base64');
const library = [
  { Id: 'a1', Name: 'Alien', Type: 'Movie', ProductionYear: 1979, RunTimeTicks: 70_200_000_000, Overview: 'In space no one can hear you scream.', Genres: ['Horror', 'Science Fiction'], ProviderIds: { Tmdb: '348' }, ImageTags: { Primary: 'x' } },
  { Id: 'a2', Name: 'Arrival', Type: 'Movie', ProductionYear: 2016, Genres: ['Science Fiction'], ImageTags: { Primary: 'x' } },
  { Id: 's1', Name: 'Twin Peaks', Type: 'Series', ProductionYear: 1990, ImageTags: { Primary: 'x' } },
  { Id: 'm1', Name: 'Blue', Type: 'MusicAlbum', ProductionYear: 1971, AlbumArtist: 'Joni Mitchell', ImageTags: {} },
  { Id: 'b1', Name: 'Dune', Type: 'Book', ProductionYear: 1965, ImageTags: {} },
];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://jellyfin');
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (url.pathname === '/System/Info/Public') return json(200, { ServerName: 'Trial media box', ProductName: 'Jellyfin Server', Version: '10.11.11' });
  if (/^\/Items\/[^/]+\/Images\/Primary$/.test(url.pathname)) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
  if (url.pathname === '/Items') {
    if (req.headers.authorization !== `MediaBrowser Token="${KEY}"`) return json(401, {});
    const start = Number(url.searchParams.get('startIndex') ?? 0);
    const limit = Number(url.searchParams.get('limit') ?? 100);
    return json(200, { Items: library.slice(start, start + limit), TotalRecordCount: library.length, StartIndex: start });
  }
  return json(404, {});
}).listen(8097, '127.0.0.1', () => console.log('stand-in Jellyfin on 8097'));
