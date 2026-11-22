// A stand-in for NHTSA's recalls API, for trying Recall alerts. It answers /recalls/recallsByVehicle the way the
// real one does: for one known car (a 2019 Subaru Outback) two recalls, and for any make, model and year it has no
// table for, a 400 with no results. Every request it is asked is kept, and read back at /log, so a walk-through
// can check what was, and was not, sent.
import { createServer } from 'node:http';

const asked = [];
const recalls = [
  {
    Manufacturer: 'Subaru of America, Inc.', NHTSACampaignNumber: '19V493000', parkIt: false, parkOutSide: false, overTheAirUpdate: false, ReportReceivedDate: '26/06/2019',
    Component: 'STRUCTURE', Summary: "Subaru of America, Inc. (Subaru) is recalling certain 2019 Legacy and Outback vehicles.  Spot welds located on the duct below the cowl panel may have been improperly applied, impacting the vehicle's body strength.",
    Consequence: 'In the event of a crash, the reduced strength of the vehicle body may increase the risk of injury.', Remedy: 'Subaru will notify owners, and dealers will inspect and repair the welds, free of charge.',
    Notes: 'Owners may also contact the National Highway Traffic Safety Administration Vehicle Safety Hotline at 1-888-327-4236.', ModelYear: '2019', Make: 'SUBARU', Model: 'OUTBACK',
  },
  {
    Manufacturer: 'Subaru of America, Inc.', NHTSACampaignNumber: '20V555000', parkIt: false, parkOutSide: true, overTheAirUpdate: false, ReportReceivedDate: '14/08/2020',
    Component: 'FUEL SYSTEM, GASOLINE:DELIVERY:HOSES, LINES, FITTINGS, AND ASSEMBLIES', Summary: 'Subaru of America, Inc. (Subaru) is recalling certain 2019 Outback vehicles.  A fuel line may crack and leak fuel near hot engine parts.',
    Consequence: 'A fuel leak in the presence of an ignition source can increase the risk of a fire.', Remedy: 'Dealers will replace the fuel line, free of charge. Owners are advised to park outside and away from structures until the repair is made.',
    Notes: '', ModelYear: '2019', Make: 'SUBARU', Model: 'OUTBACK',
  },
];

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://nhtsa');
  const json = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  if (url.pathname === '/log') return json(200, asked);
  if (url.pathname !== '/recalls/recallsByVehicle') return json(404, {});
  asked.push({ url: req.url, userAgent: req.headers['user-agent'] ?? null, headers: Object.keys(req.headers).sort() });
  const [make, model, year] = ['make', 'model', 'modelYear'].map((k) => (url.searchParams.get(k) ?? '').toLowerCase());
  if (make === 'subaru' && model === 'outback' && year === '2019') return json(200, { Count: recalls.length, Message: 'Results returned successfully', results: recalls });
  return json(400, { Count: 0, Message: 'Results returned successfully', results: [] });
}).listen(8100, '127.0.0.1', () => console.log('stand-in NHTSA on 8100'));
