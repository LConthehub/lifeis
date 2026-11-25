/** Reading a time out of a recipe step, for the cooking timer's one-tap button. */
import { expect, it } from 'vitest';
import { minutesInStep, timerName } from '../src/cookTimer.ts';

it('reads minutes', () => {
  expect(minutesInStep('Simmer 12 minutes, stirring now and then.')).toBe(12);
  expect(minutesInStep('Cook for 5 min')).toBe(5);
  expect(minutesInStep('Rest it 10-minute')).toBe(10);
  expect(minutesInStep('Simmer until thick, about twenty minutes.')).toBe(20);
  expect(minutesInStep('Wait a minute')).toBe(1);
});

it('reads hours, fractions and halves', () => {
  expect(minutesInStep('Bake for 1 hour')).toBe(60);
  expect(minutesInStep('Roast 2 hrs')).toBe(120);
  expect(minutesInStep('Braise for 1 1/2 hours')).toBe(90);
  expect(minutesInStep('Chill 1/2 hour')).toBe(30);
  expect(minutesInStep('Rise for 1.5 hours')).toBe(90);
  expect(minutesInStep('Rise for 1½ hours')).toBe(90);
  expect(minutesInStep('Leave it half an hour')).toBe(30);
  expect(minutesInStep('Leave it an hour')).toBe(60);
  expect(minutesInStep('Bake 1 hour 15 minutes')).toBe(75);
});

it('uses the longer end of a range', () => {
  expect(minutesInStep('Bake 25 to 30 min')).toBe(30);
  expect(minutesInStep('Bake 25-30 minutes')).toBe(30);
  expect(minutesInStep('Simmer 1 to 1 1/2 hours')).toBe(90);
  expect(minutesInStep('Cook 8 or 10 minutes')).toBe(10);
});

it('gives nothing when no time is named, or one that makes no sense', () => {
  expect(minutesInStep('Chop the onions.')).toBeNull();
  expect(minutesInStep('Preheat the oven to 350 degrees.')).toBeNull();
  expect(minutesInStep('Add 2 cups of stock')).toBeNull();
  expect(minutesInStep('Cook 0 minutes')).toBeNull();
  expect(minutesInStep('Marinate 48 hours')).toBeNull();
  expect(minutesInStep('Stir for 30 seconds')).toBeNull();
  expect(minutesInStep('')).toBeNull();
});

it('names a timer from its step', () => {
  expect(timerName('Simmer the sauce.')).toBe('Simmer the sauce');
  expect(timerName('  ')).toBe('Timer');
  expect(timerName('Simmer gently, stirring now and then, until the sauce coats the back of a spoon').length).toBeLessThanOrEqual(44);
});
