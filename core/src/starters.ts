/**
 * Ready-made kinds of things, to start from. Nobody has to use them, and once added they are the person's own:
 * rename them, add fields, take fields away. They only save typing.
 */
import type { FieldInput } from './inventory.ts';

export type StarterKind = { name: string; icon: string; unit?: string; fields: FieldInput[] };
export type Starter = { slug: string; name: string; about: string; kinds: StarterKind[] };

const text = (name: string): FieldInput => ({ name, type: 'text' });
const number = (name: string, unit?: string): FieldInput => ({ name, type: 'number', unit });
const choice = (name: string, ...choices: string[]): FieldInput => ({ name, type: 'choice', choices });
const yesNo = (name: string): FieldInput => ({ name, type: 'yesno' });
const date = (name: string): FieldInput => ({ name, type: 'date' });
const link = (name: string): FieldInput => ({ name, type: 'link' });

export const STARTERS: Starter[] = [
  {
    slug: 'sewing',
    name: 'Sewing',
    about: 'Fabric by the yard or metre, notions, and patterns.',
    kinds: [
      { name: 'Fabric', icon: '🧵', unit: 'yd', fields: [
        choice('Type', 'Woven', 'Knit', 'Other'), text('Fibre'), number('Width', 'in'), text('Colour'), text('Print'),
        number('Weight', 'gsm'), yesNo('Prewashed'), text('Bought from') ] },
      { name: 'Notions', icon: '🪡', fields: [
        choice('Type', 'Thread', 'Zipper', 'Buttons', 'Elastic', 'Interfacing', 'Bias tape', 'Needles', 'Other'), text('Size'), text('Colour') ] },
      { name: 'Sewing patterns', icon: '✂️', fields: [
        text('Designer'), text('Pattern number'), text('Sizes'), text('Garment'), choice('Format', 'Paper', 'PDF', 'Traced'),
        yesNo('Cut out'), link('Link') ] },
    ],
  },
  {
    slug: 'knitting',
    name: 'Knitting & crochet',
    about: 'Yarn, needles and hooks, and patterns.',
    kinds: [
      { name: 'Yarn', icon: '🧶', unit: 'skein', fields: [
        text('Brand'), text('Colourway'), text('Fibre'),
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
    kinds: [
      { name: 'Wood', icon: '🪵', unit: 'ft', fields: [text('Species'), number('Thickness', 'in'), number('Width', 'in'), choice('Form', 'Board', 'Sheet', 'Dowel', 'Offcut')] },
      { name: 'Hardware', icon: '🔩', fields: [choice('Type', 'Screws', 'Nails', 'Bolts', 'Hinges', 'Brackets', 'Other'), text('Size'), text('Finish')] },
      { name: 'Finishes & glue', icon: '🧴', fields: [choice('Type', 'Stain', 'Oil', 'Varnish', 'Paint', 'Glue', 'Other'), text('Colour'), date('Opened on')] },
      { name: 'Plans', icon: '📐', fields: [text('From'), link('Link')] },
    ],
  },
  {
    slug: 'gardening',
    name: 'Gardening',
    about: 'Seeds, plants, and what goes on the soil.',
    kinds: [
      { name: 'Seeds', icon: '🌱', unit: 'packet', fields: [text('Variety'), text('From'), date('Packed for'), text('Sow'), number('Days to harvest')] },
      { name: 'Plants', icon: '🪴', fields: [text('Variety'), choice('Lives', 'Indoors', 'Outdoors', 'Greenhouse'), date('Planted on'), text('Light'), text('Watering')] },
      { name: 'Soil & feed', icon: '🧑‍🌾', fields: [choice('Type', 'Compost', 'Potting mix', 'Fertiliser', 'Mulch', 'Other'), date('Opened on')] },
    ],
  },
  {
    slug: 'home',
    name: 'Around the house',
    about: 'Tools, paint for each room, filters and bulbs, and what is in storage.',
    kinds: [
      { name: 'Tools', icon: '🧰', fields: [text('Brand'), text('Model'), date('Bought on'), text('Lent to')] },
      { name: 'Paint', icon: '🎨', fields: [text('Brand'), text('Colour name'), text('Colour code'), choice('Finish', 'Matt', 'Eggshell', 'Satin', 'Gloss'), text('Used in'), date('Opened on')] },
      { name: 'Spares', icon: '💡', fields: [text('Fits'), text('Size or model')] },
    ],
  },
];
