/**
 * The kinds of project Life Is knows by name, and the examples it shows for each, so the grayed-out hints
 * on a woodworking project talk about screws and not zippers. A kind is still whatever the person types:
 * these are only suggestions, matched on the words in it.
 *
 * Each has: `project` (an example name), `notes` (what notes are for), `uses` (something it might use),
 * `usesNote` (a note on that), and `did` (a line for the time spent on it).
 */
export const PROJECT_KINDS = [
  { name: 'Sewing', match: /sew|quilt|dressmak|tailor|embroider|cross.?stitch|needlepoint/i,
    project: 'Linen shirt dress', notes: "Measurements, changes to the pattern, what you'd do differently",
    uses: '9 inch zipper', usesNote: 'for the lining, view B…', did: 'Cut out the bodice.' },
  { name: 'Knitting & crochet', match: /knit|crochet|yarn|macram/i,
    project: 'Cabled cardigan', notes: "Gauge, needle size, changes to the pattern, what you'd do differently",
    uses: 'Stitch markers', usesNote: 'for the cuffs, held double…', did: 'Finished the left sleeve.' },
  { name: 'Woodworking', match: /wood|carpent|furniture|cabinet|whittl|turning/i,
    project: 'Garage shelves', notes: "Measurements, the cut list, the finish, what you'd do differently",
    uses: '2 inch wood screws', usesNote: 'for the back panel…', did: 'Cut and sanded the shelves.' },
  { name: 'Gardening', match: /garden|yard|plant|lawn|landscap|vegetable|orchard/i,
    project: 'Raised bed for tomatoes', notes: 'What went where, when it was sown, what did well',
    uses: 'Tomato cages', usesNote: 'for the back row…', did: 'Sowed the first row.' },
  { name: 'Home repair', match: /home|house|repair|diy|renovat|remodel|paint(?!ing a (picture|portrait))|plumb|electric|maintenance|fix/i,
    project: 'Repaint the hallway', notes: 'Paint color and finish, measurements, who did the work and what it cost',
    uses: "Painter's tape", usesNote: 'for the trim…', did: 'Patched and primed the wall.' },
  { name: 'Car & mechanics', match: /car\b|cars\b|auto|truck|motor|mechanic|engine|bike|bicycle|boat|tractor|mower/i,
    project: 'Replace the front brake pads', notes: 'Part numbers, torque specs, the mileage, what to check next time',
    uses: 'Brake cleaner', usesNote: 'for the front axle…', did: 'Swapped the front pads.' },
  { name: 'Cooking & baking', match: /cook|bak|bread|brew|ferment|canning|preserv|smok|barbecue|bbq/i,
    project: 'Sourdough starter', notes: "Timings, temperatures, what you changed and what you'd change next time",
    uses: 'Bread flour', usesNote: 'for the first feeding…', did: 'Fed the starter.' },
  { name: 'Art & crafts', match: /art\b|arts\b|craft|draw|sketch|watercolor|painting|pottery|ceramic|jewel|bead|paper|scrapbook|candle|soap|resin|leather/i,
    project: 'Watercolor of the lake', notes: "Colors and paper used, what worked, what you'd do differently",
    uses: 'Cold-press paper', usesNote: 'for the final version…', did: 'Blocked in the sky.' },
  { name: 'Electronics & computers', match: /electron|computer|solder|arduino|raspberry|robot|3d.?print|printer|code|program|server|radio/i,
    project: 'Weather station', notes: 'Part numbers, wiring, settings, what to try next',
    uses: 'Jumper wires', usesNote: 'for the sensor board…', did: 'Wired up the sensor.' },
  { name: 'Music', match: /music|guitar|piano|violin|drum|sing|song|band|record/i,
    project: 'Learn "Blackbird"', notes: 'Tuning, tempo, the hard parts, what to practice next',
    uses: 'New strings', usesNote: 'light gauge…', did: 'Practiced the intro.' },
  { name: 'Writing & study', match: /writ|book|novel|blog|journal|study|learn|course|class|language|research|genealog|family tree/i,
    project: 'Family cookbook', notes: 'The outline, sources, what is left to do',
    uses: 'Photo paper', usesNote: 'for the cover…', did: 'Drafted the first chapter.' },
  { name: 'Outdoors', match: /camp|hik|fish|hunt|outdoor|kayak|climb|trail/i,
    project: 'Get the camping gear ready', notes: 'What to pack, what ran out, what to bring next time',
    uses: 'Stove fuel', usesNote: 'for the weekend trip…', did: 'Checked the tent for leaks.' },
];

/** What is shown when the kind is empty or isn't one of the above: examples that fit anything. */
const ANY = { project: 'Garage shelves, a quilt, the spring planting', notes: "Measurements, what you changed, what you'd do differently",
  uses: 'What it needs', usesNote: 'what it is for…', did: 'What got done.' };

/** The examples to show for a kind of project, by the words in it. */
export function hintsFor(kind) {
  const words = (kind || '').trim();
  return (words && PROJECT_KINDS.find((k) => k.match.test(words))) || ANY;
}

/** The kinds to offer: the person's own first, then the ones Life Is knows that they haven't used. */
export function kindChoices(mine = []) {
  const have = new Set(mine.map((a) => a.toLowerCase()));
  return [...mine, ...PROJECT_KINDS.map((k) => k.name).filter((name) => !have.has(name.toLowerCase()))];
}
