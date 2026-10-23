import { comboKey } from '../codes.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/** How the evaluated claim compares with the other claims of its procedure-code combination. */
export type UpcodingAssessment =
  /** Fewer than `min_other_claims` other claims: not evaluated (Decision 15). */
  | { kind: 'insufficient_data'; combo: string; others: number }
  /** Every other claim has the same amount, so z is undefined: not evaluated. */
  | { kind: 'zero_sd'; combo: string; others: number; mean: number }
  | { kind: 'scored'; combo: string; others: number; mean: number; sd: number; z: number };

/**
 * An SD below this fraction of the mean is treated as 0. Σx² − (Σx)²/m subtracts two
 * nearly equal large numbers; for identical non-integer amounts the residue gives an
 * SD of up to ~4e-8 × mean (measured), which would turn a small difference into a huge z.
 */
const RELATIVE_SD_TOLERANCE = 1e-6;

/**
 * Leave-one-out mean and sample SD of the claim's combination group (Decision 3),
 * in O(1) from the group's n, Σx and Σx² in the context. Let m = n − 1 be the
 * number of other claims:
 *   mean     = (Σx − x) / m
 *   Σ(y−mean)² over the others = (Σx² − x²) − (Σx − x)² / m
 *   variance = that / (m − 1) = that / (n − 2)   — sample variance (Decision 15)
 */
export function assessUpcoding(claim: Claim, ctx: RuleContext): UpcodingAssessment {
  const combo = comboKey(claim.procedure_codes);
  const aggregate = ctx.comboAmounts.get(combo);
  const others = aggregate ? aggregate.n - 1 : 0;
  // Sample SD needs at least 2 values, whatever the configured minimum.
  const minOthers = Math.max(ctx.config.thresholds.upcoding.min_other_claims, 2);
  if (!aggregate || others < minOthers) return { kind: 'insufficient_data', combo, others };

  const amount = claim.submitted_amount;
  const sum = aggregate.sum - amount;
  const sumSquares = aggregate.sumSquares - amount ** 2;
  const mean = sum / others;
  const squaredDeviations = Math.max(0, sumSquares - (sum * sum) / others);
  const sd = Math.sqrt(squaredDeviations / (others - 1));
  if (sd <= RELATIVE_SD_TOLERANCE * Math.abs(mean)) return { kind: 'zero_sd', combo, others, mean };

  return { kind: 'scored', combo, others, mean, sd, z: (amount - mean) / sd };
}

/** Amount more than `z_threshold` sample SDs above the leave-one-out mean of its combination. */
export function upcoding(claim: Claim, ctx: RuleContext): Flag | null {
  const assessment = assessUpcoding(claim, ctx);
  const { z_threshold } = ctx.config.thresholds.upcoding;
  if (assessment.kind !== 'scored' || !(assessment.z > z_threshold)) return null;

  const { combo, others, mean, sd, z } = assessment;
  return {
    rule: 'upcoding',
    severity: ctx.config.weights.upcoding,
    evidence:
      `Amount ${formatNumber(claim.submitted_amount)} for procedures ${combo} has z = ${z.toFixed(2)} (> ${z_threshold}): ` +
      `mean ${formatNumber(mean)}, SD ${formatNumber(sd)} over ${others} other claims with the same procedure codes, ` +
      `excluding this claim`,
  };
}

/** Claims the upcoding rule could not evaluate, by reason (reported in Phase 4). */
export function countUpcodingSkips(ctx: RuleContext): { insufficientData: number; zeroSd: number } {
  let insufficientData = 0;
  let zeroSd = 0;
  for (const claim of ctx.claims) {
    const { kind } = assessUpcoding(claim, ctx);
    if (kind === 'insufficient_data') insufficientData += 1;
    else if (kind === 'zero_sd') zeroSd += 1;
  }
  return { insufficientData, zeroSd };
}
