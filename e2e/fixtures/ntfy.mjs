// A stand-in ntfy server: it keeps what was posted to each topic, and tells it back at /_seen.
import { createServer } from 'node:http';

const seen = [];
createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/_seen') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(seen)); return; }
  if (req.method !== 'POST') { res.writeHead(200); res.end('stand-in ntfy'); return; }
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    seen.push({ topic: req.url.slice(1), title: req.headers.title ?? null, priority: req.headers.priority ?? null, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: String(seen.length), event: 'message' }));
  });
}).listen(8098, '127.0.0.1', () => console.log('stand-in ntfy on 8098'));
