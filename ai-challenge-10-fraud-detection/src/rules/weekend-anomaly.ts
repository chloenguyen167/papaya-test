import { describeCode, isSurgical } from '../codes.js';
import { dayOfWeekUtc, isWeekend } from '../dates.js';
import { formatNumber } from '../format.js';
import type { Claim, Config, Flag, RuleContext } from '../types.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** The claim's surgical codes; a bundle is listed with the surgical components that make it surgical. */
function surgicalCodes(codes: readonly string[], config: Config): string[] {
  const surgical = (code: string): boolean => config.procedures[code]?.category === 'surgical';
  return codes.flatMap((code) => {
    if (surgical(code)) return [describeCode(code, config)];
    const components = (config.bundles[code]?.components ?? []).filter(surgical);
    if (components.length === 0) return [];
    return [`${describeCode(code, config)} containing ${components.map((c) => describeCode(c, config)).join(', ')}`];
  });
}

/**
 * Surgery on a Saturday or Sunday (day of week in UTC) at a provider whose
 * weekend share of surgical claims, excluding this claim, is below
 * `max_weekend_share` (Decisions 6, 19). The provider needs at least
 * `min_provider_claims` surgical claims, this one included. Surgical includes
 * bundle components (Decision 14).
 */
export function weekendAnomaly(claim: Claim, ctx: RuleContext): Flag | null {
  const { config } = ctx;
  if (!isWeekend(claim.claim_date) || !isSurgical(claim.procedure_codes, config)) return null;

  const { max_weekend_share, min_provider_claims } = config.thresholds.weekend_anomaly;
  const tally = ctx.providerSurgical.get(claim.provider_id);
  if (!tally || tally.claims < min_provider_claims) return null;

  // This claim is itself a weekend surgical claim; leave it out so it cannot raise its own baseline.
  const otherSurgical = tally.claims - 1;
  const otherWeekend = tally.weekendClaims - 1;
  if (otherSurgical <= 0) return null;
  const share = otherWeekend / otherSurgical;
  if (share >= max_weekend_share) return null;

  const day = DAY_NAMES[dayOfWeekUtc(claim.claim_date)];
  return {
    rule: 'weekend_anomaly',
    severity: config.weights.weekend_anomaly,
    evidence:
      `Surgical procedure ${surgicalCodes(claim.procedure_codes, config).join('; ')} on ${day} ${claim.claim_date} ` +
      `at provider ${claim.provider_id}, whose weekend share of surgical claims is ${(share * 100).toFixed(1)}% ` +
      `(${otherWeekend}/${otherSurgical} surgical claims, excluding this claim), below the ${formatNumber(max_weekend_share * 100)}% limit`,
  };
}
