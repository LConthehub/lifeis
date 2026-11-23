// A stand-in for a SimpleFIN bridge, for trying reading bank accounts. It never reaches outside: it listens on this
// computer only. One setup token (GOODTOKEN) can be claimed, once; a second claim, or any other token, is refused
// with 403 as the real one does. Reading needs the Basic sign-in that the access address carries (user bankuser,
// password bankpass-0123456789). Times are made fresh for each read so the walk-through works on any day. Every
// request is kept, without any password, and read back at /__log, so a walk-through can check what was, and was
// not, sent.
import { createServer } from 'node:http';

const PORT = 8102;
const USER = 'bankuser';
const PASS = 'bankpass-0123456789';
const asked = [];
let goodClaimed = false;
const noon = (daysAgo) => { const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() - daysAgo); return Math.floor(d.getTime() / 1000); };
const transactions = () => [
  { id: 'T-1', posted: noon(5), amount: '-12.30', description: 'CORNER STORE #12 AUSTIN', payee: 'Corner Store' },
  { id: 'T-2', posted: noon(4), amount: '-5', description: 'Coffee Cart' },
  { id: 'T-3', posted: noon(3), amount: '2500.00', description: 'Payroll' },
  { id: 'T-4', posted: noon(2), amount: '-48.99', description: 'Hardware Store', pending: true },
  { id: 'T-5', posted: noon(2), amount: '-1234.5', description: '', memo: 'Furnace repair' },
];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://bridge');
  const text = (status, body) => res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (url.pathname === '/__log') return json(200, asked);
  if (url.pathname.startsWith('/simplefin/claim/')) {
    asked.push({ method: req.method, path: url.pathname, bodyBytes: Number(req.headers['content-length'] ?? 0) });
    if (req.method !== 'POST') return text(405, 'POST only');
    if (url.pathname.endsWith('/GOODTOKEN') && !goodClaimed) { goodClaimed = true; return text(200, `http://${USER}:${PASS}@127.0.0.1:${PORT}/simplefin`); }
    return text(403, 'This token has been claimed already, or is not known.');
  }
  if (url.pathname === '/simplefin/accounts') {
    const signedIn = req.headers.authorization === `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
    asked.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), signedIn, credentialsInAddress: /@/.test(req.url ?? ''), bodyBytes: Number(req.headers['content-length'] ?? 0) });
    if (!signedIn) return text(403, 'Not signed in');
    const balancesOnly = url.searchParams.get('balances-only') === '1';
    return json(200, {
      errors: balancesOnly ? [] : ['Example Credit Union needs you to sign in again.'],
      accounts: [
        { id: 'A-CHK', name: 'Everyday Checking', currency: 'USD', balance: '2345.67', 'balance-date': noon(0), org: { name: 'Example Credit Union', domain: 'example-cu.test' }, transactions: balancesOnly ? [] : transactions() },
        { id: 'A-SAV', name: 'Savings', currency: 'USD', balance: '10000.00', 'balance-date': noon(0), org: { name: 'Example Credit Union', domain: 'example-cu.test' },
          transactions: balancesOnly ? [] : [{ id: 'S-1', posted: noon(3), amount: '-100.00', description: 'Transfer out' }] },
      ],
    });
  }
  return text(404, 'not here');
}).listen(PORT, '127.0.0.1', () => console.log(`stand-in SimpleFIN on ${PORT}`));
