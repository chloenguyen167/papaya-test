export interface ReferenceStats {
  /** Number of values used, i.e. excluding the evaluated one. */
  n: number;
  mean: number;
  /** Sample standard deviation (divides by n − 1). */
  sd: number;
}

/** Mean and sample SD of all values; null when there are fewer than 2. */
export function sampleStats(values: readonly number[]): ReferenceStats | null {
  return statsExcluding(values, -1);
}

/**
 * Mean and sample SD of every value except the one at `excludeIndex` (Decision 15).
 * Returns null when fewer than `minOthers` values remain, or fewer than 2
 * (sample SD is undefined for a single value).
 */
export function leaveOneOutStats(
  values: readonly number[],
  excludeIndex: number,
  minOthers: number,
): ReferenceStats | null {
  if (values.length - 1 < minOthers) return null;
  return statsExcluding(values, excludeIndex);
}

function statsExcluding(values: readonly number[], excludeIndex: number): ReferenceStats | null {
  const n = excludeIndex >= 0 && excludeIndex < values.length ? values.length - 1 : values.length;
  if (n < 2) return null;
  let sum = 0;
  values.forEach((v, i) => {
    if (i !== excludeIndex) sum += v;
  });
  const mean = sum / n;
  let squares = 0;
  values.forEach((v, i) => {
    if (i !== excludeIndex) squares += (v - mean) ** 2;
  });
  return { n, mean, sd: Math.sqrt(squares / (n - 1)) };
}
