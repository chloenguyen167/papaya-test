import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { phantomBilling } from '../../src/rules/phantom-billing.js';
import type { Claim, Config } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

/** `count` claims at one provider on one day, each from a different member. */
function dayOfClaims(count: number, provider_id = 'PRV-01', claim_date = '2024-03-06'): Claim[] {
  return Array.from({ length: count }, (_, i) => makeClaim({ provider_id, claim_date, member_id: `M-${provider_id}-${i}` }));
}

function flaggedCount(claims: Claim[], cfg: Config = config): number {
  const ctx = buildContext(claims, cfg);
  return claims.filter((c) => phantomBilling(c, ctx) !== null).length;
}

describe('phantomBilling', () => {
  it('flags no claim when a provider has exactly 30 claims in a day', () => {
    expect(flaggedCount(dayOfClaims(30))).toBe(0);
  });

  it('flags all 31 claims when a provider has 31 in a day, including the legitimate ones', () => {
    expect(flaggedCount(dayOfClaims(31))).toBe(31);
  });

  it('does not add up claims across providers: two providers with 20 each', () => {
    expect(flaggedCount([...dayOfClaims(20, 'PRV-01'), ...dayOfClaims(20, 'PRV-02')])).toBe(0);
  });

  it('does not add up claims across days: 20 a day for two days', () => {
    expect(flaggedCount([...dayOfClaims(20, 'PRV-01', '2024-03-06'), ...dayOfClaims(20, 'PRV-01', '2024-03-07')])).toBe(0);
  });

  it('flags only the busy provider-day, not the same provider on a quiet day', () => {
    const busy = dayOfClaims(31, 'PRV-01', '2024-03-06');
    const quiet = dayOfClaims(5, 'PRV-01', '2024-03-07');
    const ctx = buildContext([...busy, ...quiet], config);
    expect(busy.every((c) => phantomBilling(c, ctx) !== null)).toBe(true);
    expect(quiet.every((c) => phantomBilling(c, ctx) === null)).toBe(true);
  });

  it('reads the limit from config', () => {
    const strict: Config = {
      ...config,
      thresholds: { ...config.thresholds, phantom_billing: { max_claims_per_provider_day: 10 } },
    };
    expect(flaggedCount(dayOfClaims(11), strict)).toBe(11);
    expect(flaggedCount(dayOfClaims(10), strict)).toBe(0);
  });

  it('puts the provider, date, daily count, threshold and average per active day in the evidence', () => {
    // 31 claims on one day and 9 on another: 40 claims over 2 active days = 20 per active day.
    const claims = [...dayOfClaims(31, 'PRV-01', '2024-03-06'), ...dayOfClaims(9, 'PRV-01', '2024-03-07')];
    const flag = phantomBilling(claims[0] as Claim, buildContext(claims, config));

    expect(flag?.rule).toBe('phantom_billing');
    expect(flag?.severity).toBe(config.weights.phantom_billing);
    for (const part of ['PRV-01', '2024-03-06', '31 claims', 'limit 30', '20 claims per active day']) {
      expect(flag?.evidence).toContain(part);
    }
  });
});
