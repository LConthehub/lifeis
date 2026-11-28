/**
 * The addresses for renting (/api/things/renting), under things like licenses: free to read once a trial has ended,
 * changed only when Life Is is unlocked. What they do is core/'s renters.ts; this reads what was sent and passes it on.
 * Nothing here sends anything anywhere: the note to the landlord is only written, and the person sends it.
 */
import { MAX_RENTAL_PHOTO, renters, type Db } from '../../core/src/index.ts';
import { Refusal, read, type Body, type Context, type Route } from './http.ts';

const ID = '(\\d{1,15})';
const at = (path: string) => new RegExp(`^/api/things/renting${path.replaceAll(':id', ID)}$`);
const sent = (body: Body, name: string) => Object.hasOwn(body, name);

/** A photo sent as base64 text in the "data" field, as the pages send them. */
function photoFrom(body: Body): Uint8Array {
  const text = read.text(body, 'data');
  if (text.length > MAX_RENTAL_PHOTO * 1.4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Refusal(400, 'That photo is too large to keep, or was damaged on the way');
  return Uint8Array.from(atob(text), (letter) => letter.charCodeAt(0));
}

const noteFrom = (body: Body) => ({ what: read.maybeText(body, 'what'), since: read.maybeText(body, 'since'), place: read.maybeText(body, 'place') });

export function renterRoutes(db: Db): Route[] {
  const mine = (c: Context) => renters(db, c.user.id, c.clock);
  return [
    // The lease and the rooms together, for the page.
    ['GET', at(''), async (c) => ({ json: { lease: await mine(c).lease(), rooms: await mine(c).rooms() } })],
    ['PUT', at('/lease'), async (c) => ({ json: await mine(c).setLease({
      start_day: read.maybeText(c.body, 'start_day'), end_day: read.maybeText(c.body, 'end_day'), rent_day: read.maybeWhole(c.body, 'rent_day'), deposit_cents: read.maybeWhole(c.body, 'deposit_cents'),
      landlord_name: read.maybeText(c.body, 'landlord_name'), landlord_contact: read.maybeText(c.body, 'landlord_contact'), notice_day: read.maybeText(c.body, 'notice_day'), notice_label: read.maybeText(c.body, 'notice_label'),
    }) })],
    ['DELETE', at('/lease'), async (c) => (await mine(c).clearLease(), { status: 204 })],

    // A landlord's job: the note as it would be written, asking (keeps the note), the notes kept, and fixed.
    ['POST', at('/jobs/:id/preview'), async (c) => ({ json: await mine(c).preview(c.id, noteFrom(c.body)) })],
    ['POST', at('/jobs/:id/ask'), async (c) => ({ status: 201, json: await mine(c).ask(c.id, noteFrom(c.body)) })],
    ['GET', at('/jobs/:id/notes'), async (c) => ({ json: await mine(c).notes(c.id) })],
    ['POST', at('/jobs/:id/fixed'), async (c) => ({ json: await mine(c).fixed(c.id, read.maybeText(c.body, 'day')) })],

    // The move-in and move-out record.
    ['POST', at('/rooms'), async (c) => ({ status: 201, json: await mine(c).addRoom(read.text(c.body, 'name')) })],
    ['PUT', at('/rooms/:id'), async (c) => ({ json: await mine(c).updateRoom(c.id, {
      ...(sent(c.body, 'name') ? { name: read.text(c.body, 'name') } : {}),
      ...(sent(c.body, 'in_note') ? { in_note: read.maybeText(c.body, 'in_note') } : {}),
      ...(sent(c.body, 'out_note') ? { out_note: read.maybeText(c.body, 'out_note') } : {}),
    }) })],
    ['DELETE', at('/rooms/:id'), async (c) => ({ json: await mine(c).removeRoom(c.id) })],
    ['POST', at('/rooms/:id/photos'), async (c) => ({ status: 201, json: await mine(c).addPhoto(c.id, read.text(c.body, 'phase'), photoFrom(c.body), read.maybeText(c.body, 'day')) })],
    ['GET', at('/photos/:id'), async (c) => {
      const photo = await mine(c).photo(c.id);
      return { body: photo.bytes, headers: { 'Content-Type': photo.type, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' } };
    }],
    ['DELETE', at('/photos/:id'), async (c) => ({ json: await mine(c).removePhoto(c.id) })],
  ];
}
