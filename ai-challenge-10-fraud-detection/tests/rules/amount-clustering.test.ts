import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { amountClustering } from '../../src/rules/amount-clustering.js';
import type { Claim, Config } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

function evaluate(claim: Claim, others: Claim[] = [], cfg: Config = config) {
  return amountClustering(claim, buildContext([claim, ...others], cfg));
}

describe('amountClustering', () => {
  it('does not flag 47,499 (just below the band)', () => {
    expect(evaluate(makeClaim({ submitted_amount: 47_499 }))).toBeNull();
  });

  it('flags 47,500 (lower edge of the band)', () => {
    expect(evaluate(makeClaim({ submitted_amount: 47_500 }))?.rule).toBe('amount_clustering');
  });

  it('flags 49,999 (upper edge of the band)', () => {
    expect(evaluate(makeClaim({ submitted_amount: 49_999 }))?.rule).toBe('amount_clustering');
  });

  it('does not flag 50,000 (at the threshold itself)', () => {
    expect(evaluate(makeClaim({ submitted_amount: 50_000 }))).toBeNull();
  });

  it('flags 49,999.50 (cents above 49,999 but still below the threshold)', () => {
    expect(evaluate(makeClaim({ submitted_amount: 49_999.5 }))?.rule).toBe('amount_clustering');
  });

  it('flags everything strictly below the threshold, up to 49,999.99', () => {
    expect(evaluate(makeClaim({ submitted_amount: 49_999.99 }))?.rule).toBe('amount_clustering');
    expect(evaluate(makeClaim({ submitted_amount: 47_499.99 }))).toBeNull();
  });

  it('states the band as 47,500 ≤ amount < 50,000 in the evidence', () => {
    const evidence = evaluate(makeClaim({ submitted_amount: 49_999.5 }))?.evidence ?? '';
    expect(evidence).toContain('Amount 49,999.5 ');
    expect(evidence).toContain('flag band 47,500 ≤ amount < 50,000');
  });

  it('reads the threshold and band from config: with a 100,000 threshold, 49,000 is no longer flagged', () => {
    const scaled: Config = {
      ...config,
      thresholds: {
        ...config.thresholds,
        amount_clustering: { auto_approval_threshold: 100_000, min_amount: 95_000, max_amount: 99_999 },
      },
    };
    const claim = makeClaim({ submitted_amount: 49_000 });
    expect(evaluate(claim, [], config)).not.toBeNull();
    expect(evaluate(claim, [], scaled)).toBeNull();
    expect(evaluate(makeClaim({ submitted_amount: 95_000 }), [], scaled)).not.toBeNull();
  });

  it('uses the configured weight as severity', () => {
    expect(evaluate(makeClaim({ submitted_amount: 48_000 }))?.severity).toBe(config.weights.amount_clustering);
  });

  it('puts the amount, percentage of the threshold and the threshold in the evidence', () => {
    const evidence = evaluate(makeClaim({ submitted_amount: 49_500 }))?.evidence ?? '';
    expect(evidence).toContain('49,500');
    expect(evidence).toContain('99.0%');
    expect(evidence).toContain('50,000');
  });

  it('adds the typical amount of the procedure combination, excluding the claim itself', () => {
    const codes = ['P-1007', 'B-9002'];
    const claim = makeClaim({ procedure_codes: codes, submitted_amount: 49_000 });
    const others = [30_000, 40_000].map((submitted_amount) => makeClaim({ procedure_codes: [...codes].reverse(), submitted_amount }));
    const evidence = evaluate(claim, others)?.evidence ?? '';
    expect(evidence).toContain('B-9002+P-1007');
    expect(evidence).toContain('35,000');
    expect(evidence).toContain('2 other claims');
  });

  it('omits the typical amount when the combination has no other claims', () => {
    const evidence = evaluate(makeClaim({ submitted_amount: 49_000 }))?.evidence ?? '';
    expect(evidence).not.toContain('typical');
  });
});
