/**
 * Ready-made kinds of things, to start from. Nobody has to use them, and once added they are the person's own:
 * rename them, add fields, take fields away. They only save typing.
 */
import type { FieldInput } from './inventory.ts';
import { labelKey } from './small.ts';

export type StarterKind = {
  name: string; icon: string; unit?: string; fields: FieldInput[];
  /** What the things of this kind are for: the name of a kind of project ("Car & mechanics"), so they show up as gear on one. */
  activity?: string;
};
/** `group` is the plain heading the Things page files this set's kinds under. */
export type Starter = { slug: string; name: string; about: string; group: string; kinds: StarterKind[] };

const text = (name: string): FieldInput => ({ name, type: 'text' });
const number = (name: string, unit?: string): FieldInput => ({ name, type: 'number', unit });
const choice = (name: string, ...choices: string[]): FieldInput => ({ name, type: 'choice', choices });
const yesNo = (name: string): FieldInput => ({ name, type: 'yesno' });
const date = (name: string): FieldInput => ({ name, type: 'date' });
const link = (name: string): FieldInput => ({ name, type: 'link' });

/**
 * What each set's things are for, as the names of the kinds of project (frontend/src/projectKinds.js), so "Your
 * gear for Car & mechanics" finds them. Clothes and linens are for nothing in particular.
 */
const ACTIVITY_OF_SET: Record<string, string | undefined> = {
  sewing: 'Sewing', cookware: 'Cooking & baking', knitting: 'Yarn crafts', woodworking: 'Woodworking', gardening: 'Gardening',
  clothing: undefined, home: 'Home repair', car: 'Car & mechanics', art: 'Art & crafts', electronics: 'Electronics & computers',
  music: 'Music', outdoors: 'Outdoors',
};

const SETS: Starter[] = [
  {
    slug: 'sewing',
    name: 'Sewing',
    about: 'Fabric by the yard or meter, notions, and patterns.',
    group: 'Crafts',
    kinds: [
      { name: 'Fabric', icon: '🧵', unit: 'yd', fields: [
        choice('Type', 'Woven', 'Knit', 'Other'), text('Fiber'), number('Width', 'in'), text('Color'), text('Print'),
        number('Weight', 'gsm'), yesNo('Prewashed'), text('Bought from') ] },
      { name: 'Notions', icon: '🪡', fields: [
        choice('Type', 'Thread', 'Zipper', 'Buttons', 'Elastic', 'Interfacing', 'Bias tape', 'Needles', 'Other'), text('Size'), text('Color') ] },
      { name: 'Sewing patterns', icon: '✂️', fields: [
        text('Designer'), text('Pattern number'), text('Sizes'), text('Garment'), choice('Format', 'Paper', 'PDF', 'Traced'),
        yesNo('Cut out'), link('Link') ] },
    ],
  },
  {
    slug: 'cookware',
    name: 'Cookware and kitchen gear',
    about: 'Cast iron, pots and pans, baking dishes and tools: what you cook in, so recipes can say which.',
    group: 'Cooking',
    kinds: [
      { name: 'Cast iron', icon: '🍳', fields: [
        text('Maker'), text('Made'), text('Size'), text('Pattern or model number'),
        choice('Kind', 'Skillet', 'Dutch oven', 'Griddle', 'Grill pan', 'Bakeware', 'Other'),
        choice('Condition', 'Daily user', 'Good', 'Needs restoring', 'Display only'), date('Last seasoned'), text('Care notes'), text('Bought from'), number('Paid') ] },
      { name: 'Pots and pans', icon: '🥘', fields: [text('Maker'), text('Size'), choice('Material', 'Stainless', 'Non-stick', 'Carbon steel', 'Copper', 'Enamel', 'Aluminum', 'Other'), yesNo('Oven safe'), text('Care notes')] },
      { name: 'Baking dishes', icon: '🥧', fields: [text('Size'), choice('Material', 'Glass', 'Ceramic', 'Metal', 'Stoneware', 'Silicone'), text('Maker'), yesNo('Has a lid')] },
      { name: 'Kitchen tools', icon: '🔪', fields: [text('Maker'), text('Size or model'), text('Care notes')] },
    ],
  },
  {
    slug: 'knitting',
    name: 'Yarn crafts',
    about: 'Yarn and cord, needles and hooks, and patterns for knitting, crochet and macrame, the 1970s favorite.',
    group: 'Crafts',
    kinds: [
      { name: 'Yarn', icon: '🧶', unit: 'skein', fields: [
        text('Brand'), text('Colorway'), text('Fiber'),
        choice('Weight', 'Lace', 'Fingering', 'Sport', 'DK', 'Worsted', 'Aran', 'Bulky', 'Super bulky'),
        number('Length per skein', 'm'), text('Dye lot') ] },
      { name: 'Needles & hooks', icon: '🥢', fields: [
        choice('Type', 'Straight', 'Circular', 'Double-pointed', 'Interchangeable', 'Crochet hook'), number('Size', 'mm'), number('Length', 'cm'), text('Material') ] },
      { name: 'Knitting patterns', icon: '📄', fields: [text('Designer'), text('For'), choice('Format', 'Paper', 'PDF', 'Book'), link('Link')] },
    ],
  },
  {
    slug: 'woodworking',
    name: 'Woodworking',
    about: 'Boards and sheet goods, hardware, finishes, and plans.',
    group: 'Workshop',
    kinds: [
      { name: 'Wood', icon: '🪵', unit: 'ft', fields: [text('Species'), number('Thickness', 'in'), number('Width', 'in'), choice('Form', 'Board', 'Sheet', 'Dowel', 'Offcut')] },
      { name: 'Hardware', icon: '🔩', fields: [choice('Type', 'Screws', 'Nails', 'Bolts', 'Hinges', 'Brackets', 'Other'), text('Size'), text('Finish')] },
      { name: 'Finishes & glue', icon: '🧴', fields: [choice('Type', 'Stain', 'Oil', 'Varnish', 'Paint', 'Glue', 'Other'), text('Color'), date('Opened on')] },
      { name: 'Plans', icon: '📐', fields: [text('From'), link('Link')] },
    ],
  },
  {
    slug: 'gardening',
    name: 'Gardening',
    about: 'Seeds, plants, and what goes on the soil.',
    group: 'Garden',
    kinds: [
      { name: 'Seeds', icon: '🌱', unit: 'packet', fields: [text('Variety'), text('From'), date('Packed for'), text('Sow'), number('Days to harvest')] },
      { name: 'Plants', icon: '🪴', fields: [text('Variety'), choice('Lives', 'Indoors', 'Outdoors', 'Greenhouse'), date('Planted on'), text('Light'), text('Watering')] },
      { name: 'Soil & feed', icon: '🧑‍🌾', fields: [choice('Type', 'Compost', 'Potting mix', 'Fertiliser', 'Mulch', 'Other'), date('Opened on')] },
    ],
  },
  {
    slug: 'clothing',
    name: 'Clothes, shoes and linens',
    about: 'What everyone wears and in what size, and the sheets that fit each bed.',
    group: 'Clothes and linens',
    kinds: [
      { name: 'Clothes', icon: '👕', fields: [
        text('Size'), text('Whose'), choice('Type', 'Top', 'Bottom', 'Dress', 'Outerwear', 'Underwear', 'Sleepwear', 'Sportswear', 'Other'),
        text('Brand'), text('Color'), choice('Season', 'All year', 'Warm weather', 'Cold weather'), text('Care') ] },
      { name: 'Shoes', icon: '👟', fields: [text('Size'), text('Whose'), text('Brand'), text('Color'), choice('Season', 'All year', 'Warm weather', 'Cold weather')] },
      { name: 'Bedding and linens', icon: '🛏', fields: [
        choice('Size', 'Crib', 'Twin', 'Twin XL', 'Full', 'Queen', 'King', 'Cal King', 'Other'), choice('Type', 'Sheets', 'Duvet cover', 'Blanket', 'Pillowcase', 'Towel', 'Tablecloth', 'Other'),
        text('For which bed or room'), text('Color') ] },
    ],
  },
  {
    slug: 'home',
    name: 'Around the house',
    about: 'Tools, paint for each room, filters and bulbs, and what is in storage.',
    group: 'Around the house',
    kinds: [
      { name: 'Tools', icon: '🧰', fields: [text('Brand'), text('Model'), date('Bought on'), text('Lent to')] },
      { name: 'Paint', icon: '🎨', fields: [text('Brand'), text('Color name'), text('Color code'), choice('Finish', 'Matt', 'Eggshell', 'Satin', 'Gloss'), text('Used in'), date('Opened on')] },
      { name: 'Spares', icon: '💡', fields: [text('Fits'), text('Size or model')] },
    ],
  },
  {
    slug: 'car',
    name: 'Car & garage',
    about: 'Cars and trucks, oil and filters, spare parts, and the tools to work on them.',
    group: 'Garage',
    kinds: [
      { name: 'Vehicles', icon: '🚗', fields: [
        text('Make'), text('Model'), number('Year'), text('VIN'), text('License plate'), text('Tire size'), text('Oil type'),
        number('Mileage', 'mi'), date('Registration expires') ] },
      { name: 'Fluids and filters', icon: '🛢️', unit: 'qt', fields: [
        choice('Type', 'Motor oil', 'Coolant', 'Brake fluid', 'Transmission fluid', 'Washer fluid', 'Oil filter', 'Air filter', 'Cabin filter', 'Other'),
        text('Grade or part number'), text('Fits'), text('Brand') ] },
      { name: 'Car parts and spares', icon: '⚙️', fields: [text('Part'), text('Part number'), text('Fits'), text('Brand'), yesNo('New'), date('Bought on')] },
      { name: 'Car tools', icon: '🔧', fields: [text('Brand'), text('Size'), choice('Type', 'Wrench', 'Socket', 'Jack', 'Jack stands', 'Diagnostic', 'Other'), text('Lent to')] },
    ],
  },
  {
    slug: 'art',
    name: 'Art & crafts',
    about: 'Paints and inks, paper and canvas, brushes, and beads, clay and other craft supplies.',
    group: 'Crafts',
    kinds: [
      { name: 'Paints and inks', icon: '🖌️', unit: 'tube', fields: [
        choice('Type', 'Watercolor', 'Acrylic', 'Oil', 'Gouache', 'Ink', 'Pastel', 'Other'), text('Brand'), text('Color'), text('Size'), date('Opened on') ] },
      { name: 'Paper and canvas', icon: '🖼️', unit: 'sheet', fields: [
        choice('Type', 'Watercolor paper', 'Drawing paper', 'Cardstock', 'Canvas', 'Panel', 'Sketchbook', 'Other'), text('Size'), number('Weight', 'lb'), text('Surface') ] },
      { name: 'Brushes and art tools', icon: '✏️', fields: [text('Type'), text('Size'), text('Brand'), text('Used for')] },
      { name: 'Craft supplies', icon: '📿', fields: [
        choice('Type', 'Beads', 'Clay', 'Resin', 'Wax', 'Leather', 'Glue', 'Findings', 'Other'), text('Color'), text('Brand'), text('Size') ] },
    ],
  },
  {
    slug: 'electronics',
    name: 'Electronics & computers',
    about: 'Computers and gadgets with their warranties, cables, parts, and batteries.',
    group: 'Electronics',
    kinds: [
      { name: 'Devices', icon: '💻', fields: [
        text('Maker'), text('Model'), text('Serial number'), date('Bought on'), date('Warranty until'), text('Used by'), link('Manual') ] },
      { name: 'Cables and adapters', icon: '🔌', fields: [
        choice('Type', 'USB', 'HDMI', 'Ethernet', 'Power', 'Audio', 'Video', 'Adapter', 'Other'), text('Connectors'), number('Length', 'ft') ] },
      { name: 'Components', icon: '🎛️', unit: 'pc', fields: [
        choice('Type', 'Resistor', 'Capacitor', 'LED', 'Chip', 'Sensor', 'Board', 'Switch', 'Other'), text('Value'), text('Part number'), text('Where it is from') ] },
      { name: 'Batteries and chargers', icon: '🔋', fields: [
        choice('Type', 'AA', 'AAA', 'C', 'D', '9V', 'Coin cell', 'Rechargeable pack', 'Charger', 'Other'), text('Fits'), yesNo('Rechargeable') ] },
    ],
  },
  {
    slug: 'music',
    name: 'Music',
    about: 'Instruments, strings and reeds, sheet music, and audio gear.',
    group: 'Music',
    kinds: [
      { name: 'Instruments', icon: '🎸', fields: [
        text('Maker'), text('Model'), text('Serial number'), choice('Kind', 'Guitar', 'Bass', 'Keyboard', 'Violin', 'Winds', 'Brass', 'Drums', 'Other'),
        date('Bought on'), text('Played by') ] },
      { name: 'Strings, reeds and supplies', icon: '🎵', fields: [
        choice('Type', 'Strings', 'Reeds', 'Picks', 'Rosin', 'Sticks', 'Cables', 'Other'), text('Fits'), text('Gauge or strength'), text('Brand') ] },
      { name: 'Sheet music and books', icon: '🎼', fields: [text('Title'), text('Composer'), text('Instrument'), choice('Format', 'Paper', 'PDF', 'Book')] },
      { name: 'Audio gear', icon: '🎧', fields: [text('Maker'), text('Model'), text('Serial number'), date('Bought on')] },
    ],
  },
  {
    slug: 'outdoors',
    name: 'Outdoors',
    about: 'Camping gear, fishing tackle, sports gear, and bikes.',
    group: 'Outdoors',
    kinds: [
      { name: 'Camping gear', icon: '⛺', fields: [
        choice('Type', 'Tent', 'Sleeping bag', 'Stove', 'Pack', 'Cooler', 'Lantern', 'Other'), text('Brand'), text('Size'), number('Weight', 'lb'), date('Last checked') ] },
      { name: 'Fishing tackle', icon: '🎣', fields: [
        choice('Type', 'Rod', 'Reel', 'Lures', 'Hooks', 'Line', 'Net', 'Tackle box', 'Other'), text('Brand'), text('Size'), text('For which fish') ] },
      { name: 'Sports gear', icon: '⚽', fields: [text('Sport'), text('Whose'), text('Size'), text('Brand')] },
      { name: 'Bikes', icon: '🚲', fields: [text('Maker'), text('Model'), text('Frame size'), text('Serial number'), text('Whose'), date('Last serviced')] },
    ],
  },
];

export const STARTERS: Starter[] = SETS.map((set) => ({
  ...set,
  kinds: set.kinds.map((kind) => (ACTIVITY_OF_SET[set.slug] ? { ...kind, activity: ACTIVITY_OF_SET[set.slug] } : kind)),
}));

/** The headings the Things page uses, in the order it shows them. Kinds that fit no set go under "Other", last. */
export const KIND_GROUPS = ['Cooking', 'Crafts', 'Workshop', 'Garage', 'Garden', 'Outdoors', 'Electronics', 'Music', 'Around the house', 'Clothes and linens'] as const;

/** Which heading a kind belongs under, by its name (capitals and spacing don't matter), or null if no ready-made set has it. */
export function groupOfKind(name: string): string | null {
  const key = labelKey(name);
  return STARTERS.find((starter) => starter.kinds.some((kind) => labelKey(kind.name) === key))?.group ?? null;
}
