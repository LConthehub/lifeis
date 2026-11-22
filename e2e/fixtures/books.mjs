// Stand-in book servers for trying the Servers page, all on one port: an Audiobookshelf (/api/libraries, a
// token), a Calibre-Web (/opds, a username and password) and a Kavita (/api/opds/<key>). They answer the way
// each program's own documentation says it does; they are not the programs themselves.
import { createServer } from 'node:http';

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const xml = (res, body) => res.writeHead(200, { 'Content-Type': 'application/atom+xml;profile=opds-catalog;charset=utf-8' }).end(`<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">${body}</feed>`);
const calibre = [[11, 'Dune', 'Frank Herbert', '9780441172719'], [12, 'Kindred', 'Octavia E. Butler', ''], [13, 'Emma', 'Jane Austen', '']];
const entry = ([n, title, author, isbn]) => `<entry><title>${title}</title><id>urn:uuid:calibre-${n}</id><author><name>${author}</name></author>${isbn ? `<dc:identifier>urn:isbn:${isbn}</dc:identifier>` : ''}
  <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/opds/download/${n}/epub/"/><link rel="http://opds-spec.org/image" type="image/jpeg" href="/opds/cover/${n}"/></entry>`;
const lead = (id, title, href) => `<entry><title>${title}</title><id>${id}</id><link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="${href}"/></entry>`;

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://books');
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  // Audiobookshelf
  if (url.pathname === '/api/libraries') {
    if (req.headers.authorization !== 'Bearer trial-abs-token') return json(401, {});
    return json(200, { libraries: [{ id: 'lib_main', name: 'Audiobooks', mediaType: 'book' }, { id: 'lib_pod', name: 'Podcasts', mediaType: 'podcast' }] });
  }
  if (url.pathname === '/api/libraries/lib_main/items') {
    return json(200, { total: 2, results: [
      { id: 'li_dune', mediaType: 'book', media: { metadata: { title: 'Dune', authorName: 'Frank Herbert', publishedYear: '1965', isbn: '9780441172719', genres: ['Science Fiction'] }, numAudioFiles: 22, duration: 75_840 } },
      { id: 'li_hail', mediaType: 'book', media: { metadata: { title: 'Project Hail Mary', authorName: 'Andy Weir', publishedYear: '2021', genres: [] }, numAudioFiles: 30, duration: 58_200 } },
    ] });
  }
  if (/^\/api\/items\/[^/]+\/cover$/.test(url.pathname) || url.pathname.startsWith('/opds/cover/')) return res.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(JPEG);
  // Calibre-Web: two to a page, so the "next" link is followed.
  if (url.pathname === '/opds/books/letter/00') {
    if (req.headers.authorization !== `Basic ${Buffer.from('reader:trial-calibre-pass').toString('base64')}`) return res.writeHead(401).end();
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const next = offset + 2 < calibre.length ? `<link rel="next" type="application/atom+xml;profile=opds-catalog" href="/opds/books/letter/00?offset=${offset + 2}"/>` : '';
    return xml(res, next + calibre.slice(offset, offset + 2).map(entry).join(''));
  }
  // Kavita
  if (url.pathname === '/api/opds/trial-kavita-key/libraries') return xml(res, lead('1', 'Comics', '/api/opds/trial-kavita-key/libraries/1'));
  if (url.pathname === '/api/opds/trial-kavita-key/libraries/1') return xml(res, lead('40', 'Bone', '/api/opds/trial-kavita-key/series/40'));
  if (url.pathname.startsWith('/api/opds/')) return res.writeHead(401).end();
  return json(404, {});
}).listen(8099, '127.0.0.1', () => console.log('stand-in book servers on 8099'));
