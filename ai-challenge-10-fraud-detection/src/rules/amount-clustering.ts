import { comboKey } from '../codes.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/** Amount in [min_amount, max_amount], just below the auto-approval threshold (Decision 8). */
export function amountClustering(claim: Claim, ctx: RuleContext): Flag | null {
  const { auto_approval_threshold, min_amount, max_amount } = ctx.config.thresholds.amount_clustering;
  const amount = claim.submitted_amount;
  if (amount < min_amount || amount > max_amount) return null;

  const percent = ((amount / auto_approval_threshold) * 100).toFixed(1);
  let evidence =
    `Amount ${formatNumber(amount)} is ${percent}% of the ${formatNumber(auto_approval_threshold)} ` +
    `auto-approval threshold (flag band ${formatNumber(min_amount)}–${formatNumber(max_amount)})`;

  const combo = comboKey(claim.procedure_codes);
  const aggregate = ctx.comboAmounts.get(combo);
  if (aggregate && aggregate.n > 1) {
    const others = aggregate.n - 1;
    const typical = (aggregate.sum - amount) / others;
    evidence += `; typical amount for ${combo} is ${formatNumber(typical)} (mean of ${others} other claims)`;
  }

  return { rule: 'amount_clustering', severity: ctx.config.weights.amount_clustering, evidence };
}
