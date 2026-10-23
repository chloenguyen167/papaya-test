import { referencePrice } from '../codes.js';
import type { Config } from '../types.js';
import { PARAMS } from './params.js';
import type { Rng } from './rng.js';

export function roundTo10(amount: number): number {
  return Math.round(amount / 10) * 10;
}

export function inClusteringBand(amount: number, config: Config): boolean {
  const band = config.thresholds.amount_clustering;
  return amount >= band.min_amount && amount <= band.max_amount;
}

/**
 * A "normal" amount for a list of codes: each code's reference price times
 * lognormal noise, summed and rounded to 10. Amounts in the clustering band
 * are resampled (Decision 12). Shared by clean and fraudulent claims so the
 * amount distribution does not reveal the label.
 */
export function sampleAmount(rng: Rng, codes: readonly string[], config: Config): number {
  for (let attempt = 0; attempt < PARAMS.maxAttempts; attempt++) {
    const raw = codes.reduce(
      (sum, code) => sum + referencePrice(code, config) * Math.exp(PARAMS.amountNoiseSigma * rng.normal()),
      0,
    );
    const amount = roundTo10(raw);
    if (!inClusteringBand(amount, config)) return amount;
  }
  throw new Error(`Could not sample an amount outside the clustering band for ${codes.join('|')}`);
}
