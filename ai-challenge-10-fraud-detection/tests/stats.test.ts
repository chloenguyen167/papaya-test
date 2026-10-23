import { describe, expect, it } from 'vitest';
import { leaveOneOutStats } from '../src/stats.js';

describe('leaveOneOutStats', () => {
  it('evaluates a claim when exactly 10 other claims remain (group of 11)', () => {
    const values = [...Array<number>(10).fill(1000), 5000];
    expect(leaveOneOutStats(values, 10, 10)).toEqual({ n: 10, mean: 1000, sd: 0 });
  });

  it('skips a claim when only 9 other claims remain (group of 10)', () => {
    const values = [...Array<number>(9).fill(1000), 5000];
    expect(leaveOneOutStats(values, 9, 10)).toBeNull();
  });

  it('excludes the evaluated value from mean and SD', () => {
    // Others: 2, 4, 4, 4, 5, 5, 7, 9 → mean 5, sum of squares 32.
    const values = [2, 4, 4, 4, 5, 100, 5, 7, 9];
    const stats = leaveOneOutStats(values, 5, 2);
    expect(stats?.n).toBe(8);
    expect(stats?.mean).toBe(5);
    // Sample SD divides by n − 1 = 7, not by n = 8 (which would give exactly 2).
    expect(stats?.sd).toBeCloseTo(Math.sqrt(32 / 7), 10);
  });
});
