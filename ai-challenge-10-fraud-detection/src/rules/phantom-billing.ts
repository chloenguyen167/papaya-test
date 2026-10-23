import { providerDayKey } from '../context.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * Flags every claim of a provider-day with more than `max_claims_per_provider_day`
 * claims (Decision 5). The legitimate claims on that day are flagged too; they
 * are known false positives.
 */
export function phantomBilling(claim: Claim, ctx: RuleContext): Flag | null {
  const { max_claims_per_provider_day } = ctx.config.thresholds.phantom_billing;
  const dayClaims = ctx.providerDayClaims.get(providerDayKey(claim))?.length ?? 0;
  if (dayClaims <= max_claims_per_provider_day) return null;

  const total = ctx.providerWeekend.get(claim.provider_id)?.claims ?? dayClaims;
  const activeDays = ctx.providerActiveDays.get(claim.provider_id) ?? 1;
  const average = formatNumber(total / activeDays, 2);

  return {
    rule: 'phantom_billing',
    severity: ctx.config.weights.phantom_billing,
    evidence:
      `Provider ${claim.provider_id} submitted ${dayClaims} claims on ${claim.claim_date} ` +
      `(limit ${max_claims_per_provider_day}); its average is ${average} claims per active day ` +
      `(${total} claims over ${activeDays} active days)`,
  };
}
