import { describe, expect, it } from 'vitest';
import { addDays, datesInYear, dayOfWeekUtc, diffDays, isValidIsoDate, isWeekend } from '../src/dates.js';

describe('dates', () => {
  it('computes the day of week in UTC', () => {
    expect(dayOfWeekUtc('2024-01-01')).toBe(1); // Monday
    expect(isWeekend('2024-06-15')).toBe(true); // Saturday
    expect(isWeekend('2024-06-16')).toBe(true); // Sunday
    expect(isWeekend('2024-06-17')).toBe(false);
  });

  it('adds days across month and year ends, including the leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-28', 7)).toBe('2025-01-04');
    expect(diffDays('2024-12-31', '2025-01-01')).toBe(1);
  });

  it('rejects malformed and non-existent dates', () => {
    expect(isValidIsoDate('2024-02-30')).toBe(false);
    expect(isValidIsoDate('2024-2-03')).toBe(false);
    expect(isValidIsoDate('2024-12-31')).toBe(true);
  });

  it('lists all 366 days of 2024', () => {
    const days = datesInYear(2024);
    expect(days).toHaveLength(366);
    expect(days[0]).toBe('2024-01-01');
    expect(days.at(-1)).toBe('2024-12-31');
  });
});
