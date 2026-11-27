/**
 * Pets: who each one is and who looks after them (the vet, the microchip number), a photo, how their weight
 * goes, and their care. Care is upkeep that belongs to a pet (upkeep.ts): vaccinations every year, flea
 * treatment every month. So it comes due, is reminded of, and keeps each time it was done, like everything
 * else that comes round.
 *
 * `pets(db, owner)` is one person's pets: everything it reads and writes is theirs.
 */
import { atomic, type Db, type Queries, type Value } from './db.ts';
import { Problem } from './problem.ts';
import { attachTags, onlyTagged, unlink, type TagRef } from './tags.ts';
import { clean, dayNumber, dayOrNull, pictureType, stamp, todayOf, type Clock } from './small.ts';
import { upkeep, type EveryUnit, type Job, type JobKind } from './upkeep.ts';

export type PetInput = {
  name: string; species?: string | null; breed?: string | null; born_on?: string | null; microchip?: string | null;
  vet_name?: string | null; vet_phone?: string | null; food?: string | null; note?: string | null;
};
export type PetWeight = { id: number; day: string; value: number; unit: string };
export type PetSummary = {
  id: number; name: string; species: string | null; breed: string | null; born_on: string | null; photo: boolean;
  /** Its care that's late, due or coming up soon. */
  care_due: number;
  /** The most pressing of its care: "Vaccinations", and how it stands. */
  next: { id: number; name: string; state: Job['due']['state']; days_left: number | null } | null;
  tag_list: TagRef[];
};
export type Pet = PetSummary & {
  microchip: string | null; vet_name: string | null; vet_phone: string | null; food: string | null; note: string | null;
  care: Job[]; weights: PetWeight[];
};
export const MAX_PET_PHOTO = 8_000_000;
export const WEIGHT_UNITS = ['lb', 'kg', 'oz', 'g'] as const;

/** Care most pets of a kind need, to start from. `for` is the species it suits; left out, any. */
export const PET_CARE: { name: string; every_n: number; every_unit: EveryUnit; kind?: JobKind; for?: string[] }[] = [
  { name: 'Vet check-up', every_n: 1, every_unit: 'year' },
  { name: 'Vaccinations', every_n: 1, every_unit: 'year', for: ['dog', 'cat', 'rabbit', 'ferret', 'horse'] },
  { name: 'Flea and tick treatment', every_n: 1, every_unit: 'month', for: ['dog', 'cat'] },
  { name: 'Heartworm prevention', every_n: 1, every_unit: 'month', for: ['dog'] },
  { name: 'Worming', every_n: 3, every_unit: 'month', for: ['dog', 'cat', 'horse'] },
  { name: 'Nail trim', every_n: 6, every_unit: 'week', for: ['dog', 'cat', 'rabbit', 'guinea pig'] },
  { name: 'Grooming', every_n: 2, every_unit: 'month', for: ['dog', 'cat'] },
  { name: 'Teeth cleaning', every_n: 1, every_unit: 'year', for: ['dog', 'cat'] },
  { name: 'Clean the litter box', every_n: 1, every_unit: 'day', for: ['cat'] },
  { name: 'Clean the cage or tank', every_n: 1, every_unit: 'week', for: ['bird', 'fish', 'hamster', 'guinea pig', 'rabbit', 'reptile'] },
  { name: 'Renew the license', every_n: 1, every_unit: 'year', kind: 'renewal', for: ['dog'] },
];

type Row = {
  id: number; name: string; species: string | null; breed: string | null; born_on: string | null; microchip: string | null;
  vet_name: string | null; vet_phone: string | null; food: string | null; note: string | null; photo: number;
};
const COLUMNS = 'id, name, species, breed, born_on, microchip, vet_name, vet_phone, food, note, photo_type IS NOT NULL AS photo';
const PRESSING = ['overdue', 'due', 'soon'];

export function pets(db: Db, owner: number, clock: Clock = () => new Date()) {
  const now = () => stamp(clock());

  async function row(q: Queries, id: number): Promise<Row> {
    const found = await q.get<Row>(`SELECT ${COLUMNS} FROM pets WHERE id = ? AND owner_id = ?`, [id, owner]);
    if (!found) throw new Problem(404, "That pet isn't here anymore. It may have been deleted.");
    return found;
  }

  /** A pet's own columns, checked, in the order the SQL below names them. */
  function checked(input: PetInput): Value[] {
    const name = clean(input.name, 80);
    if (!name) throw new Problem(400, 'Give them a name');
    if (input.born_on != null && !dayOrNull(input.born_on)) throw new Problem(400, 'Pick the day they were born (a guess is fine)');
    if (input.born_on != null && dayNumber(input.born_on) > dayNumber(todayOf(clock))) throw new Problem(400, "They can't have been born after today");
    return [name, clean(input.species, 40)?.toLowerCase() ?? null, clean(input.breed, 80), dayOrNull(input.born_on), clean(input.microchip, 40),
      clean(input.vet_name, 120), clean(input.vet_phone, 40), clean(input.food, 300), clean(input.note, 3000)];
  }

  function summary(r: Row, care: Job[]): PetSummary {
    const mine = care.filter((j) => j.pet?.id === r.id);
    const first = mine[0]; // upkeep lists the most pressing first
    return {
      id: r.id, name: r.name, species: r.species, breed: r.breed, born_on: r.born_on, photo: Boolean(r.photo),
      care_due: mine.filter((j) => PRESSING.includes(j.due.state)).length,
      next: first && first.due.state !== 'unscheduled' ? { id: first.id, name: careName(first.name, r.name), state: first.due.state, days_left: first.due.days_left } : null,
      tag_list: [],
    };
  }

  async function whole(id: number): Promise<Pet> {
    const r = await row(db, id);
    const care = (await upkeep(db, owner, clock).list()).filter((j) => j.pet?.id === id);
    return {
      ...summary(r, care), tag_list: (await attachTags(db, owner, 'pet', [{ id }]))[0]!.tag_list, microchip: r.microchip, vet_name: r.vet_name, vet_phone: r.vet_phone, food: r.food, note: r.note, care,
      weights: await db.all<PetWeight>('SELECT id, day, value, unit FROM pet_weights WHERE pet_id = ? ORDER BY day DESC, id DESC LIMIT 100', [id]),
    };
  }

  return {
    async list(find: { tag?: number | null } = {}): Promise<PetSummary[]> {
      const care = await upkeep(db, owner, clock).list();
      const found = await onlyTagged(db, owner, 'pet', await db.all<Row>(`SELECT ${COLUMNS} FROM pets WHERE owner_id = ? ORDER BY name COLLATE NOCASE, id`, [owner]), find.tag);
      return attachTags(db, owner, 'pet', found.map((r) => summary(r, care)));
    },
    get: whole,

    async create(input: PetInput): Promise<Pet> {
      const made = await db.run(
        'INSERT INTO pets (owner_id, name, species, breed, born_on, microchip, vet_name, vet_phone, food, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [owner, ...checked(input), now(), now()]);
      return whole(made.lastId);
    },

    async update(id: number, input: PetInput): Promise<Pet> {
      await row(db, id);
      await db.run('UPDATE pets SET name = ?, species = ?, breed = ?, born_on = ?, microchip = ?, vet_name = ?, vet_phone = ?, food = ?, note = ?, updated_at = ? WHERE id = ?',
        [...checked(input), now(), id]);
      return whole(id);
    },

    /** Remove a pet, with its care and its weights. */
    async remove(id: number): Promise<void> {
      await atomic(db, async (tx) => {
        // The pet's routines go with them, and their tags.
        for (const r of await tx.all<{ id: number }>('SELECT r.id FROM routines r JOIN pets p ON p.id = r.for_pet WHERE p.id = ? AND p.owner_id = ?', [id, owner])) {
          await tx.run('DELETE FROM routines WHERE id = ?', [r.id]);
          await unlink(tx, 'routine', r.id);
        }
        await tx.run('DELETE FROM pets WHERE id = ? AND owner_id = ?', [id, owner]);
        await unlink(tx, 'pet', id);
      });
    },

    /** The care that suits this pet and isn't already theirs. */
    async careOffered(id: number): Promise<typeof PET_CARE> {
      const pet = await whole(id);
      const has = new Set(pet.care.map((j) => careName(j.name, pet.name).toLowerCase()));
      return PET_CARE.filter((c) => (!c.for || !pet.species || c.for.includes(pet.species)) && !has.has(c.name.toLowerCase()));
    },

    /** Give a pet some care: upkeep that is theirs. `last_done` says when it was last done, if known. */
    async addCare(id: number, input: { name: string; every_n?: number | null; every_unit?: string | null; kind?: string | null; last_done?: string | null; first_due?: string | null }): Promise<Pet> {
      const pet = await row(db, id);
      const name = clean(input.name, 150);
      if (!name) throw new Problem(400, 'Say what the care is');
      await upkeep(db, owner, clock).create({
        name: `${pet.name}: ${name}`, activity: 'Pets', pet_id: id, kind: input.kind ?? 'job', every_n: input.every_n ?? null, every_unit: input.every_unit ?? null,
        first_due: input.first_due ?? null, ...(input.last_done ? { last_done: { day: input.last_done } } : {}),
      });
      return whole(id);
    },

    async addWeight(id: number, input: { value: number; unit: string; day?: string | null }): Promise<Pet> {
      await row(db, id);
      if (!(input.value > 0 && input.value < 100000)) throw new Problem(400, 'A weight is a number more than 0');
      if (!(WEIGHT_UNITS as readonly string[]).includes(input.unit)) throw new Problem(400, 'A weight is in lb, kg, oz or g');
      if (input.day != null && !dayOrNull(input.day)) throw new Problem(400, 'Pick the day they were weighed');
      await db.run('INSERT INTO pet_weights (pet_id, day, value, unit) VALUES (?, ?, ?, ?)', [id, dayOrNull(input.day) ?? todayOf(clock), input.value, input.unit]);
      return whole(id);
    },

    async removeWeight(weightId: number): Promise<void> {
      await db.run('DELETE FROM pet_weights WHERE id = ? AND pet_id IN (SELECT id FROM pets WHERE owner_id = ?)', [weightId, owner]);
    },

    async setPhoto(id: number, bytes: Uint8Array): Promise<Pet> {
      const type = pictureType(bytes);
      if (!type) throw new Problem(400, "That isn't a photo Life Is can keep (JPEG, PNG or WebP)");
      if (bytes.length > MAX_PET_PHOTO) throw new Problem(400, 'That photo is too large to keep');
      return atomic(db, async (tx) => {
        await row(tx, id);
        await tx.run('UPDATE pets SET photo_type = ?, photo = ?, updated_at = ? WHERE id = ?', [type, bytes, now(), id]);
      }).then(() => whole(id));
    },

    async photo(id: number): Promise<{ type: string; bytes: Uint8Array } | null> {
      const found = await db.get<{ type: string | null; bytes: Uint8Array | null }>('SELECT photo_type AS type, photo AS bytes FROM pets WHERE id = ? AND owner_id = ?', [id, owner]);
      return found?.type && found.bytes ? { type: found.type, bytes: found.bytes } : null;
    },

    async removePhoto(id: number): Promise<Pet> {
      await row(db, id);
      await db.run('UPDATE pets SET photo_type = NULL, photo = NULL WHERE id = ?', [id]);
      return whole(id);
    },
  };
}

/** A pet's care without their name in front: "Rex: Vaccinations" is "Vaccinations" on Rex's own page. */
export function careName(job: string, pet: string): string {
  return job.startsWith(`${pet}: `) ? job.slice(pet.length + 2) : job;
}

export type Pets = ReturnType<typeof pets>;
