/**
 * The addresses for medicines. What they do is core/'s medicines.ts; this only reads what was sent and passes it on.
 * The phone app answers the same addresses on the device, through everydayRoutes.
 *
 * Taking a dose is not here: a medicine is a step in a routine, and checking the step (/api/routine-day/steps/:id) is taking it.
 * Nothing about a medicine is in search, the assistant or the AI connection.
 */
import { medicines, MAX_MEDICINE_PHOTO, type Db, type MedicineInput } from '../../core/src/index.ts';
import { read, Refusal, type Body, type Context, type Route } from './http.ts';

const ID = '([0-9]{1,15})';
const at = (path: string) => new RegExp(`^/api/${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

function photoFrom(body: Body): Uint8Array {
  const text = read.text(body, 'data');
  if (text.length > MAX_MEDICINE_PHOTO * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Refusal(400, 'That photo is too large to keep, or was damaged on the way');
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

/** A medicine as a page sent it. A part that is not sent is left as it is (or empty, for a new one). */
function medicineFrom(body: Body): MedicineInput {
  const input: MedicineInput = {
    name: read.text(body, 'name'),
    dose: read.maybeText(body, 'dose'), when_taken: read.maybeText(body, 'when_taken'),
    left: read.maybeWhole(body, 'left'), per_dose: read.maybeWhole(body, 'per_dose'), fill_size: read.maybeWhole(body, 'fill_size'),
    prescriber_name: read.maybeText(body, 'prescriber_name'), prescriber_phone: read.maybeText(body, 'prescriber_phone'),
    pharmacy_name: read.maybeText(body, 'pharmacy_name'), pharmacy_phone: read.maybeText(body, 'pharmacy_phone'),
    reason: read.maybeText(body, 'reason'), note: read.maybeText(body, 'note'),
  };
  if (sent(body, 'for_pet') || sent(body, 'for_member')) { input.for_pet = read.maybeWhole(body, 'for_pet'); input.for_member = read.maybeWhole(body, 'for_member'); }
  if (sent(body, 'times')) input.times = read.wholes(body, 'times');
  if (sent(body, 'make')) input.make = read.texts(body, 'make');
  return input;
}

export function medicineRoutes(db: Db): Route[] {
  const mine = (c: Context) => medicines(db, c.user.id, c.clock);
  return [
    ['GET', at('medicines'), async (c) => ({ json: await mine(c).list() })],
    ['POST', at('medicines'), async (c) => ({ status: 201, json: await mine(c).create(medicineFrom(c.body)) })],
    // The one switch, a person's own: whether a reminder shows the names.
    ['PUT', at('medicines/settings'), async (c) => ({ json: await mine(c).setShowNames(read.yesNo(c.body, 'show_names')) })],
    ['GET', at('medicines/:id'), async (c) => ({ json: await mine(c).get(c.id) })],
    ['PUT', at('medicines/:id'), async (c) => ({ json: await mine(c).update(c.id, medicineFrom(c.body)) })],
    ['DELETE', at('medicines/:id'), async (c) => (await mine(c).remove(c.id), { status: 204 })],
    ['POST', at('medicines/:id/refilled'), async (c) => ({ json: await mine(c).refilled(c.id, read.maybeWhole(c.body, 'amount')) })],
    ['PUT', at('medicines/:id/sharing'), async (c) => ({ json: await mine(c).shareWith(c.id, read.wholes(c.body, 'people')) })],
    ['PUT', at('medicines/:id/photo'), async (c) => ({ json: await mine(c).setPhoto(c.id, photoFrom(c.body)) })],
    ['DELETE', at('medicines/:id/photo'), async (c) => ({ json: await mine(c).removePhoto(c.id) })],
    ['GET', at('medicines/:id/photo'), async (c) => {
      const photo = await mine(c).photo(c.id);
      if (!photo) return { status: 404, json: { detail: 'Not found' } };
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } };
    }],
  ];
}
