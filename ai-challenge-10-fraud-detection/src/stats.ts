export interface ReferenceStats {
  /** Number of values used, i.e. excluding the evaluated one. */
  n: number;
  mean: number;
  /** Sample standard deviation (divides by n − 1). */
  sd: number;
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
  const n = values.length - 1;
  if (n < Math.max(minOthers, 2)) return null;
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
