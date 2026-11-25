import PrintFrame, { PrintMushroom, PrintStripe } from './PrintFrame';
import { usePrintStyle } from './printStyle';
import { feedingFrom, fitList, linesOf, manualParts, shorten } from './manualParts';
import { ZINE_SHEET, zinePanels } from './zineLayout';

const PHRASE = 'Life is tidy';
const tel = (phone) => phone.replace(/[^0-9+]/g, '');
const dayText = () => new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
const hostOf = (address) => String(address ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');

/** One entry of the manual on paper: what it is, where, the number, and what to know. */
function Entry({ e }) {
  return (
    <div className="pm-entry" data-entry={e.title}>
      <b>{e.title}</b>{e.place && <span> · {e.place}</span>}
      {e.phone && <p className="pm-phone">{e.phone}</p>}
      {e.body && <p>{e.body}</p>}
    </div>
  );
}

function Part({ title, children, id }) {
  return <section data-part={id}><h3 className="pm-h font-display">{title}</h3>{children}</section>;
}

function WifiBlock({ wifi, entry, picture, size }) {
  if (!entry) return null;
  return (
    <div className="pm-wifi" data-wifi>
      {wifi && picture && <img src={picture} alt="A code to join the Wi-Fi: point a phone's camera at it" style={size ? { width: size, height: size } : undefined} />}
      <div>
        {wifi ? (
          <>
            <p>Network: <span className="pm-mono">{wifi.network}</span></p>
            {wifi.password && <p>Password: <span className="pm-mono">{wifi.password}</span></p>}
            {picture && <p className="zine-note">Point a phone's camera at the code to join.</p>}
          </>
        ) : <p>{entry.body}</p>}
      </div>
    </div>
  );
}

/** A page number at the foot of each page, in the style's own color. The size and margins are for a letter page. */
function PageRules({ margin, numbers = false, landscape = false }) {
  const [style] = usePrintStyle();
  const ink = style === 'black' ? '#000' : '#422a17';
  return <style>{`@page { size: letter${landscape ? ' landscape' : ''}; margin: ${margin}; ${numbers ? `@bottom-center { content: "Page " counter(page); font: 600 9pt "Nunito Variable", sans-serif; color: ${ink}; }` : ''} }`}</style>;
}

/** The full manual, on letter pages: emergencies and who to call first, then the Wi-Fi, pets, how the house works, and home services. */
function FullManual({ parts, services, wifiPicture }) {
  const pets = parts.pets;
  return (
    <PrintFrame phrase={PHRASE} title="House Manual" sub={`Made on ${dayText()}`} className="pm pm-full" data-sheet="full" aria-label="The full house manual">
      <PageRules margin="0.6in 0.6in 0.75in" numbers />
      {parts.emergencies.length > 0 && <Part id="emergencies" title="In an emergency">{parts.emergencies.map((e) => <Entry key={e.id} e={e} />)}</Part>}
      {parts.contacts.length > 0 && <Part id="contacts" title="Who to call">{parts.contacts.map((e) => <Entry key={e.id} e={e} />)}</Part>}
      {parts.wifiEntry && <Part id="wifi" title="Wi-Fi"><WifiBlock wifi={parts.wifi} entry={parts.wifiEntry} picture={wifiPicture} /></Part>}
      {pets.length > 0 && (
        <Part id="pets" title="Pets">
          {pets.map((p) => (
            <div key={p.id} className="pm-entry" data-pet={p.name}>
              <b>{p.name}</b>{p.species && <span> · {p.species}</span>}
              {p.food && <p>Food: {p.food}</p>}
              {(p.vet_name || p.vet_phone) && <p>Vet: {p.vet_name}{p.vet_name && p.vet_phone && ' · '}<span className="pm-phone">{p.vet_phone}</span></p>}
              {p.note && <p>{p.note}</p>}
            </div>
          ))}
        </Part>
      )}
      {(parts.quirks.length > 0 || parts.daily.length > 0) && (
        <Part id="quirks" title="How the house works">
          {[...parts.quirks, ...parts.daily].map((e) => <Entry key={e.id} e={e} />)}
        </Part>
      )}
      {services.length > 0 && (
        <Part id="services" title="Home services">
          {services.map((s) => (
            <div key={s.id} className="pm-entry" data-service={s.name}>
              <b>{s.name}</b>{s.group && <span> · {s.group}</span>}
              <p className="pm-mono">{hostOf(s.address)}{s.address_at === 'home' ? ' (works at home)' : s.address_at === 'away' ? ' (works away from home)' : ''}</p>
              {s.address2 && <p className="pm-mono">{hostOf(s.address2)}{s.address2_at === 'home' ? ' (works at home)' : s.address2_at === 'away' ? ' (works away from home)' : ''}</p>}
              {s.note && <p>{s.note}</p>}
            </div>
          ))}
        </Part>
      )}
    </PrintFrame>
  );
}

/** One page for the fridge: emergency numbers, the Wi-Fi with its code, and how to feed the pets. */
function FridgeSheet({ parts, feeding, wifiPicture }) {
  const numbers = [{ name: 'Emergency (fire, police, ambulance)', phone: '911' }, ...parts.contacts.filter((c) => c.phone).slice(0, 6).map((c) => ({ name: c.title, phone: c.phone }))];
  const vets = parts.pets.filter((p) => p.vet_phone).map((p) => ({ name: `${p.name}'s vet${p.vet_name ? `: ${p.vet_name}` : ''}`, phone: p.vet_phone }));
  const where = parts.emergencies.slice(0, 5);
  const fed = feeding.length > 0 ? feeding : parts.pets.filter((p) => p.food).map((p) => ({ pet: p.name, time: null, steps: [p.food] }));
  return (
    <PrintFrame phrase={PHRASE} title="On the fridge" sub="Numbers, Wi-Fi and the pets" className="pm pm-fridge" data-sheet="fridge" aria-label="The fridge sheet">
      <PageRules margin="0.6in" />
      <Part id="numbers" title="Emergency numbers">
        <ul className="pm-numbers">
          {[...numbers, ...vets.slice(0, 2)].map((n) => <li key={n.name + n.phone}><span>{n.name}</span><span className="pm-phone">{n.phone}</span></li>)}
        </ul>
        {where.length > 0 && <p className="zine-note" style={{ marginTop: '0.08in' }}>{where.map((e) => `${e.title}${e.place ? ` (${e.place})` : ''}`).join(' · ')}</p>}
      </Part>
      <div className="pm-cols">
        {parts.wifiEntry && <Part id="wifi" title="Wi-Fi"><WifiBlock wifi={parts.wifi} entry={parts.wifiEntry} picture={wifiPicture} size="1.9in" /></Part>}
        {fed.length > 0 && (
          <Part id="feeding" title="Feeding the pets">
            {fed.map((f) => (
              <div key={f.pet + (f.time ?? '')} className="pm-entry" data-feeding={f.pet}>
                <b>{f.pet}</b>{f.time && <span> · {f.time}{f.at ? `, ${f.at}` : ''}</span>}
                {f.steps.map((s) => <p key={s}>{s}</p>)}
              </div>
            ))}
          </Part>
        )}
      </div>
    </PrintFrame>
  );
}

// ---------- The pocket zine ----------

const ACROSS = 34;       // about how many characters of 8.5 pt words fit across a panel
const LINES = 20;        // and how many lines fit down one, under its heading

function More() { return <p className="z-more">More in the full manual.</p>; }

/** Entries made to fit a panel: each one's words shortened, and as many as fit. */
function Fitted({ entries, lines = LINES }) {
  const short = entries.map((e) => ({ ...e, body: e.body ? shorten(e.body, 110) : null }));
  const { shown, cut } = fitList(short, lines - 1, (e) => linesOf(`${e.title}${e.place ? ` · ${e.place}` : ''}`, ACROSS) + (e.phone ? 1 : 0) + (e.body ? linesOf(e.body, ACROSS) : 0));
  const shortened = entries.some((e) => e.body && shorten(e.body, 110) !== e.body.replace(/\s+/g, ' ').trim());
  return (
    <>
      {shown.map((e) => (
        <div key={e.id} className="z-item"><b>{e.title}</b>{e.place && <span> · {e.place}</span>}
          {e.phone && <p className="z-phone">{e.phone}</p>}{e.body && <p>{e.body}</p>}</div>
      ))}
      {(cut || shortened) && <More />}
    </>
  );
}

function ZinePanel({ page, turn, content, parts, services, wifiPicture, feeding }) {
  const turned = turn === 180 ? ' is-turned' : '';
  const nothing = (words) => <p className="z-item">{words}</p>;
  let body = null;
  let title = null;
  if (content === 'cover') {
    return (
      <div className={`zine-panel zine-cover${turned}`} data-page={page} data-content={content}>
        <PrintStripe />
        <div style={{ marginTop: '0.12in' }}><PrintMushroom size="1in" /></div>
        <p className="z-phrase font-display">{PHRASE}</p>
        <h3 className="z-big font-display">House Manual</h3>
        <p className="zine-note">A pocket guide to looking after our home.</p>
        <p className="zine-note" style={{ marginTop: '0.1in' }}>Made on {dayText()}</p>
      </div>
    );
  }
  if (content === 'back') {
    return (
      <div className={`zine-panel${turned}`} data-page={page} data-content={content}>
        <p className="z-phrase font-display" style={{ fontSize: '14pt', fontWeight: 650, color: '#e7602c', margin: 0 }}>{PHRASE}</p>
        <p className="z-item" style={{ marginTop: '0.1in' }}>Everything else is in the full manual. Ask whoever gave you this.</p>
        <p className="zine-note" data-fold-and-cut style={{ marginTop: '0.2in' }}><b>Fold and cut.</b> Fold the sheet in half, top to bottom. Cut along the dashed line between the middle four panels, open it, fold the long way, and push the ends together.</p>
        <div style={{ position: 'absolute', left: '0.2in', right: '0.2in', bottom: '0.18in' }}><PrintStripe /></div>
      </div>
    );
  }
  if (content === 'emergencies') {
    title = 'In an emergency';
    body = parts.emergencies.length ? <Fitted entries={parts.emergencies} /> : nothing('Nothing written yet.');
  } else if (content === 'contacts') {
    title = 'Who to call';
    body = (
      <>
        <div className="z-item"><b>Emergency</b><p className="z-phone">911</p></div>
        {parts.contacts.length ? <Fitted entries={parts.contacts} lines={LINES - 3} /> : nothing('Nothing written yet.')}
      </>
    );
  } else if (content === 'wifi') {
    title = 'Wi-Fi';
    body = parts.wifiEntry ? (
      <div className="z-wifi" data-wifi>
        {parts.wifi && wifiPicture && <img src={wifiPicture} alt="A code to join the Wi-Fi: point a phone's camera at it" />}
        {parts.wifi ? (
          <>
            <p>Network: <span className="z-mono">{parts.wifi.network}</span></p>
            {parts.wifi.password && <p>Password: <span className="z-mono">{parts.wifi.password}</span></p>}
            <p className="zine-note" style={{ marginTop: '0.05in' }}>Point a phone's camera at the code to join.</p>
          </>
        ) : <p>{shorten(parts.wifiEntry.body, 160)}</p>}
      </div>
    ) : nothing('Nothing written yet.');
  } else if (content === 'pets') {
    title = 'Pets';
    const items = parts.pets.length ? parts.pets : [];
    const fedBy = (name) => feeding.filter((f) => f.pet === name);
    const { shown, cut } = fitList(items, LINES - 1, (p) => 1 + (p.food ? linesOf(`Food: ${shorten(p.food, 70)}`, ACROSS) : 0) + (p.vet_phone || p.vet_name ? 2 : 0) + (p.note ? 2 : 0));
    body = items.length ? (
      <>
        {shown.map((p) => (
          <div key={p.id} className="z-item" data-pet={p.name}><b>{p.name}</b>{p.species && <span> · {p.species}</span>}
            {p.food && <p>Food: {shorten(p.food, 70)}</p>}
            {fedBy(p.name).slice(0, 1).map((f) => <p key={f.time}>{f.time}: {shorten(f.steps.join(', '), 60)}</p>)}
            {(p.vet_name || p.vet_phone) && <p>Vet: {shorten(p.vet_name ?? '', 30)}{p.vet_name && p.vet_phone && ' · '}<span className="z-phone">{p.vet_phone}</span></p>}
            {p.note && <p>{shorten(p.note, 70)}</p>}
          </div>
        ))}
        {cut && <More />}
      </>
    ) : nothing('No pets.');
  } else if (content === 'quirks') {
    title = 'How the house works';
    const all = [...parts.quirks, ...parts.daily];
    body = all.length ? <Fitted entries={all} /> : nothing('Nothing written yet.');
  } else if (content === 'services') {
    title = 'Home services';
    const rows = services.map((s) => ({ id: s.id, title: s.name, body: hostOf(s.address), phone: null, place: null }));
    body = rows.length ? <Fitted entries={rows} /> : nothing('No links yet.');
  }
  return (
    <div className={`zine-panel${turned}`} data-page={page} data-content={content}>
      <h3 className="font-display">{title}</h3>
      {body}
    </div>
  );
}

/** The eight panels for the fold-into-eighths-with-one-cut zine, on one letter sheet. See zineLayout.js for why they sit this way. */
function ZineGrid(props) {
  return (
    <div className="zine-grid" style={{ width: `${ZINE_SHEET.width}in` }}>
      {zinePanels().map((p) => <ZinePanel key={p.page} {...p} {...props} />)}
      <span className="zine-fold-v" style={{ left: '25%' }} aria-hidden="true" />
      <span className="zine-fold-v" style={{ left: '50%' }} aria-hidden="true" />
      <span className="zine-fold-v" style={{ left: '75%' }} aria-hidden="true" />
      <span className="zine-fold-h" aria-hidden="true" />
      <span className="zine-cut" data-cut-line aria-hidden="true" />
    </div>
  );
}

/**
 * The house manual on paper, in the way chosen: 'full' (letter pages), 'fridge' (one page) or 'zine' (one sheet folded into
 * a pocket booklet). Only on paper. Private entries are left out unless `includePrivate`. `services` are the links the
 * person printing can see.
 */
export default function ManualSheets({ way, manual, services, routines, wifiPicture, includePrivate }) {
  const parts = manualParts(manual, { includePrivate });
  const feeding = feedingFrom(routines);
  return (
    <div className="manual-print hidden print:block" data-way={way}>
      {way === 'fridge' && <FridgeSheet parts={parts} feeding={feeding} wifiPicture={wifiPicture} />}
      {way === 'zine' && <ZineOnly parts={parts} services={services} wifiPicture={wifiPicture} feeding={feeding} />}
      {way !== 'fridge' && way !== 'zine' && <FullManual parts={parts} services={services} wifiPicture={wifiPicture} />}
    </div>
  );
}

/** The zine has no page title of its own: its cover is the title. The frame is kept for the print style, without its head. */
function ZineOnly(props) {
  const [style] = usePrintStyle();
  return (
    <section className="pf pm zine" data-print-style={style} data-sheet="zine" data-zine aria-label="The pocket zine">
      <PageRules margin="0.25in" landscape />
      <ZineGrid {...props} />
    </section>
  );
}
