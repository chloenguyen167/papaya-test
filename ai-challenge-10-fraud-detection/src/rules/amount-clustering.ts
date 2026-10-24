import { comboKey } from '../codes.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * min_amount ≤ amount < auto_approval_threshold, just below the threshold (Decision 8).
 * The upper bound is the threshold itself, so amounts with cents such as 49,999.50 are caught.
 */
export function amountClustering(claim: Claim, ctx: RuleContext): Flag | null {
  const { auto_approval_threshold, min_amount } = ctx.config.thresholds.amount_clustering;
  const amount = claim.submitted_amount;
  if (amount < min_amount || amount >= auto_approval_threshold) return null;

  const percent = ((amount / auto_approval_threshold) * 100).toFixed(1);
  let evidence =
    `Amount ${formatNumber(amount)} is ${percent}% of the ${formatNumber(auto_approval_threshold)} ` +
    `auto-approval threshold (flag band ${formatNumber(min_amount)} ≤ amount < ${formatNumber(auto_approval_threshold)})`;

  const combo = comboKey(claim.procedure_codes);
  const aggregate = ctx.comboAmounts.get(combo);
  if (aggregate && aggregate.n > 1) {
    const others = aggregate.n - 1;
    const typical = (aggregate.sum - amount) / others;
    evidence += `; typical amount for ${combo} is ${formatNumber(typical)} (mean of ${others} other claims)`;
  }

  return { rule: 'amount_clustering', severity: ctx.config.weights.amount_clustering, evidence };
}
