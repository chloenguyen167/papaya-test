import type { IsoDate } from './types.js';

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since 1970-01-01 (UTC). Throws on a malformed or non-existent date. */
export function dayNumber(date: IsoDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new Error(`Invalid date "${date}": expected YYYY-MM-DD`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) {
    throw new Error(`Invalid date "${date}": no such calendar day`);
  }
  return ms / DAY_MS;
}

export function fromDayNumber(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function isValidIsoDate(value: string): boolean {
  try {
    dayNumber(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(dayNumber(date) + days);
}

/** Signed number of days from `from` to `to`. */
export function diffDays(from: IsoDate, to: IsoDate): number {
  return dayNumber(to) - dayNumber(from);
}

/** 0 = Sunday … 6 = Saturday, computed in UTC. */
export function dayOfWeekUtc(date: IsoDate): number {
  return new Date(dayNumber(date) * DAY_MS).getUTCDay();
}

export function isWeekend(date: IsoDate): boolean {
  const dow = dayOfWeekUtc(date);
  return dow === 0 || dow === 6;
}

export function datesInYear(year: number): IsoDate[] {
  const first = dayNumber(`${year}-01-01`);
  const last = dayNumber(`${year}-12-31`);
  const dates: IsoDate[] = [];
  for (let n = first; n <= last; n++) dates.push(fromDayNumber(n));
  return dates;
}
