import { cardClass } from './ui';
import { collectionTotals, dollarsText } from './collectionTools';

/**
 * What the titles shown come to: how many, what they cost and what they are worth now, all from the prices the
 * person typed. A copy is worth the value typed for it, or else what it cost; copies with neither are counted,
 * not guessed at. Nothing here is looked up.
 */
export default function CollectionSummary({ titles }) {
  const t = collectionTotals(titles);
  if (t.titles === 0) return null;
  const priced = t.cost_cents > 0 || t.worth_cents > 0;
  const stat = (label, value) => (
    <div className="min-w-[7rem]">
      <dt className="text-xs text-gray-500 dark:text-life-300">{label}</dt>
      <dd className="text-base font-semibold text-life-800 dark:text-life-50">{value}</dd>
    </div>
  );
  return (
    <section aria-label="What it all comes to" className={`${cardClass} !p-3`}>
      <dl className="flex flex-wrap gap-x-6 gap-y-2">
        {stat('Titles', t.titles)}
        {stat('Copies', t.copies)}
        {priced && stat('Cost', dollarsText(t.cost_cents))}
        {priced && stat('Worth now', dollarsText(t.worth_cents))}
        {priced && stat('Difference', `${t.difference_cents > 0 ? '+' : ''}${dollarsText(t.difference_cents)}`)}
      </dl>
      <p className="mt-2 text-xs text-gray-500 dark:text-life-300">
        {priced
          ? `Worth uses the value you typed for a copy, or else what it cost. The difference counts copies that have a cost. ${t.unvalued === 0 ? 'Every copy has one or the other.' : `${t.unvalued} ${t.unvalued === 1 ? 'copy has' : 'copies have'} no cost or value typed, and ${t.unvalued === 1 ? 'is' : 'are'} not counted.`}`
          : `No prices typed yet. Add what a copy cost, and what it's worth now, on the copy.${t.copies ? ` ${t.unvalued} ${t.unvalued === 1 ? 'copy has' : 'copies have'} no value.` : ''}`}
      </p>
    </section>
  );
}
