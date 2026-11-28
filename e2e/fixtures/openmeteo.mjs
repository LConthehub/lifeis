// A stand-in for the two Open-Meteo answers the garden asks for (the rain of the last week, and ten past years of
// each day's lowest temperature), for trying frost dates and rain that counts as watering. The rain: 0.7 inch three
// days ago. The past years: a last spring frost about April 12 and a first fall frost about October 28.
import { createServer } from 'node:http';

const asked = [];
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const back = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return dayOf(d); };

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://openmeteo');
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (url.pathname === '/log') return json(200, asked);
  asked.push(req.url);
  if (url.pathname === '/v1/forecast' && url.searchParams.get('daily') === 'precipitation_sum') {
    const days = [7, 6, 5, 4, 3, 2, 1, 0].map(back);
    return json(200, { daily: { time: days, precipitation_sum: days.map((_, i) => (i === 4 ? 0.7 : 0)) } });
  }
  if (url.pathname === '/v1/archive') {
    const year = new Date().getFullYear();
    const time = [];
    const low = [];
    for (let y = year - 10; y < year; y += 1) {
      for (const [md, value] of [['01-10', -6], [`04-${pad(10 + (y % 5))}`, -1], ['05-20', 8], [`10-${pad(26 + (y % 5))}`, -2], ['12-20', -4]]) { time.push(`${y}-${md}`); low.push(value); }
    }
    return json(200, { daily: { time, temperature_2m_min: low } });
  }
  return json(404, {});
}).listen(8103, '127.0.0.1', () => console.log('stand-in Open-Meteo on 8103'));
