/**
 * The weather, for the front page. An outside service, and so off until a person turns it on.
 *
 * It asks Open-Meteo (open-meteo.com), which needs no account and no key. Two things are ever sent there:
 * the words typed when looking for a place, and, once a place is chosen, that place's position rounded to
 * about a kilometre, to ask for its forecast. Nothing else about the person or what they keep here goes
 * anywhere. Turning it off forgets the place and the last forecast.
 *
 * `fetcher` asks a web address for its answer; it is handed in because that differs by where Life Is runs.
 */
import type { Answer, Fetcher } from './connections.ts';
import type { Db } from './db.ts';
import { Problem } from './problem.ts';
import { clean, rounded, type Clock } from './small.ts';

export const WEATHER_SERVICE = {
  name: 'Open-Meteo',
  site: 'https://open-meteo.com',
  sends: 'The words you type when looking for your town, and then the position of the place you choose (rounded to about a kilometre) each time the forecast is fetched. No account, no key, and nothing else about you.',
};

export type Units = 'c' | 'f';
export type FoundPlace = { name: string; region: string | null; country: string | null; latitude: number; longitude: number };
export type WeatherPlace = { name: string; latitude: number; longitude: number; units: Units };
export type WeatherDay = { day: string; words: string; icon: string; high: number; low: number; /** The chance of rain or snow, in percent, when the service says. */ wet: number | null };
export type Forecast = { now: { temperature: number; words: string; icon: string }; days: WeatherDay[]; /** When it was fetched. */ at: string };
export type Weather = {
  /** Whether this copy of Life Is can reach outside at all. */
  available: boolean;
  place: WeatherPlace | null;
  /** Null when no place is chosen, or the forecast couldn't be fetched and none is kept. */
  forecast: Forecast | null;
};

const PLACE = 'weather_place';
const KEPT = 'weather_forecast';
const FRESH_MINUTES = 30;

/** What the service's weather numbers (WMO codes) mean, in words. */
const SKIES: [codes: number[], words: string, icon: string][] = [
  [[0], 'Clear', '☀️'], [[1], 'Mostly clear', '🌤'], [[2], 'Partly cloudy', '⛅'], [[3], 'Overcast', '☁️'],
  [[45, 48], 'Fog', '🌫'], [[51, 53, 55], 'Drizzle', '🌦'], [[56, 57], 'Freezing drizzle', '🌧'],
  [[61, 63, 65], 'Rain', '🌧'], [[66, 67], 'Freezing rain', '🌧'], [[71, 73, 75, 77], 'Snow', '🌨'],
  [[80, 81, 82], 'Showers', '🌦'], [[85, 86], 'Snow showers', '🌨'], [[95], 'Thunderstorm', '⛈'], [[96, 99], 'Thunderstorm with hail', '⛈'],
];
export function sky(code: unknown): { words: string; icon: string } {
  const found = SKIES.find(([codes]) => codes.includes(Number(code)));
  return found ? { words: found[1], icon: found[2] } : { words: 'Weather', icon: '🌡' };
}

const number = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('not a number');
  return value;
};

async function ask(fetcher: Fetcher, url: string): Promise<Record<string, unknown>> {
  let answer: Answer;
  try {
    answer = await fetcher(url, { Accept: 'application/json' });
  } catch {
    throw new Problem(400, "The weather service couldn't be reached just now");
  }
  if (answer.status !== 200) throw new Problem(400, `The weather service answered with an error (${answer.status})`);
  try {
    const data = await answer.json();
    if (typeof data !== 'object' || data === null) throw new Error('not an answer');
    return data as Record<string, unknown>;
  } catch {
    throw new Problem(400, "The weather service's answer couldn't be read");
  }
}

/** Reads a forecast out of the service's answer; throws when it isn't shaped like one. */
export function readForecast(data: Record<string, unknown>, at: string): Forecast {
  const current = data.current as Record<string, unknown>;
  const daily = data.daily as Record<string, unknown[]>;
  const days = (daily.time as unknown[]).map((day, i): WeatherDay => {
    if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('not a day');
    const wet = daily.precipitation_probability_max?.[i];
    return { day, ...sky(daily.weather_code![i]), high: Math.round(number(daily.temperature_2m_max![i])), low: Math.round(number(daily.temperature_2m_min![i])),
      wet: typeof wet === 'number' ? Math.round(wet) : null };
  });
  return { now: { temperature: Math.round(number(current.temperature_2m)), ...sky(current.weather_code) }, days, at };
}

export function weather(db: Db, owner: number, clock: Clock = () => new Date(), fetcher?: Fetcher) {
  const setting = async (key: string): Promise<unknown> => {
    const row = await db.get<{ value: string | null }>('SELECT value FROM user_settings WHERE user_id = ? AND key = ?', [owner, key]);
    try { return row?.value ? JSON.parse(row.value) : null; } catch { return null; }
  };
  const keep = (key: string, value: unknown) => db.run(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`, [owner, key, JSON.stringify(value)]);
  const needFetcher = (): Fetcher => {
    if (!fetcher) throw new Problem(400, "This copy of Life Is isn't set up to reach outside services");
    return fetcher;
  };

  async function place(): Promise<WeatherPlace | null> {
    const p = await setting(PLACE) as WeatherPlace | null;
    return p && typeof p.name === 'string' && typeof p.latitude === 'number' && typeof p.longitude === 'number' ? { ...p, units: p.units === 'c' ? 'c' : 'f' } : null;
  }

  async function forecast(at: WeatherPlace): Promise<Forecast | null> {
    const kept = await setting(KEPT) as Forecast | null;
    const age = kept?.at ? (clock().getTime() - Date.parse(kept.at)) / 60_000 : Infinity;
    if (kept && age >= 0 && age < FRESH_MINUTES) return kept;
    if (!fetcher) return kept;
    try {
      const query = new URLSearchParams({
        latitude: String(at.latitude), longitude: String(at.longitude), current: 'temperature_2m,weather_code',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max', timezone: 'auto', forecast_days: '3',
        temperature_unit: at.units === 'c' ? 'celsius' : 'fahrenheit',
      });
      const fresh = readForecast(await ask(fetcher, `https://api.open-meteo.com/v1/forecast?${query}`), clock().toISOString());
      await keep(KEPT, fresh);
      return fresh;
    } catch {
      // The service being away never breaks the front page: the last forecast stands in, if there is one.
      return kept;
    }
  }

  const status = async (): Promise<Weather> => {
    const at = await place();
    return { available: Boolean(fetcher), place: at, forecast: at ? await forecast(at) : null };
  };

  return {
    status,
    place,

    /** Places by that name, for choosing one. This sends the words typed to the weather service. */
    async findPlaces(words: string): Promise<FoundPlace[]> {
      const name = clean(words, 100);
      if (!name || name.length < 2) throw new Problem(400, 'Type the name of a town');
      const query = new URLSearchParams({ name, count: '6', language: 'en', format: 'json' });
      const data = await ask(needFetcher(), `https://geocoding-api.open-meteo.com/v1/search?${query}`);
      const results = Array.isArray(data.results) ? data.results as Record<string, unknown>[] : [];
      return results.filter((r) => typeof r.name === 'string' && typeof r.latitude === 'number' && typeof r.longitude === 'number').map((r) => ({
        name: r.name as string, region: typeof r.admin1 === 'string' ? r.admin1 : null, country: typeof r.country === 'string' ? r.country : null,
        latitude: r.latitude as number, longitude: r.longitude as number,
      }));
    },

    /** Turn the weather on for a place, or change the place or the units. */
    async turnOn(input: { name: string; latitude: number; longitude: number; units?: string | null }): Promise<Weather> {
      needFetcher();
      const name = clean(input.name, 120);
      if (!name) throw new Problem(400, 'Choose a place');
      if (!(Math.abs(input.latitude) <= 90 && Math.abs(input.longitude) <= 180)) throw new Problem(400, "That isn't a place on Earth");
      if (input.units != null && input.units !== 'c' && input.units !== 'f') throw new Problem(400, 'Degrees are c or f');
      // Rounded to two places: near enough for a forecast, and not the house.
      await keep(PLACE, { name, latitude: rounded(input.latitude, 2), longitude: rounded(input.longitude, 2), units: input.units ?? 'f' } satisfies WeatherPlace);
      await db.run('DELETE FROM user_settings WHERE user_id = ? AND key = ?', [owner, KEPT]);
      return status();
    },

    /** Turn the weather off: the place and the last forecast are forgotten, and nothing more is asked. */
    async turnOff(): Promise<Weather> {
      await db.run('DELETE FROM user_settings WHERE user_id = ? AND key IN (?, ?)', [owner, PLACE, KEPT]);
      return status();
    },
  };
}

export type WeatherOf = ReturnType<typeof weather>;
