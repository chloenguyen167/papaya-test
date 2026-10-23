import type { Config } from './types.js';

/** Procedure-code combination key: codes sorted, then joined (Decision 3). */
export function comboKey(codes: readonly string[]): string {
  return [...codes].sort().join('+');
}

/** The claim's codes with every bundle code replaced by its components. */
export function expandBundles(codes: readonly string[], config: Config): string[] {
  return codes.flatMap((code) => config.bundles[code]?.components ?? [code]);
}

/** A claim is surgical if any code, or any component of a bundle on it, is surgical (Decision 14). */
export function isSurgical(codes: readonly string[], config: Config): boolean {
  return expandBundles(codes, config).some((code) => config.procedures[code]?.category === 'surgical');
}

export function referencePrice(code: string, config: Config): number {
  const price = config.procedures[code]?.reference_price ?? config.bundles[code]?.price;
  if (price === undefined) throw new Error(`Unknown procedure or bundle code ${code}`);
  return price;
}
