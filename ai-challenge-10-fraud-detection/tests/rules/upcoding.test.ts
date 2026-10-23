import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { assessUpcoding, countUpcodingSkips, upcoding } from '../../src/rules/upcoding.js';
import { leaveOneOutStats } from '../../src/stats.js';
import type { Claim, Config } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

/** 10 consultation amounts around 800: mean 800, sum of squared deviations 150,000. */
const AROUND_800 = [600, 650, 700, 750, 800, 800, 850, 900, 950, 1000];

function claimsOf(amounts: readonly number[], procedure_codes = ['P-1001']): Claim[] {
  return amounts.map((submitted_amount) => makeClaim({ procedure_codes: [...procedure_codes], submitted_amount }));
}

function withUpcoding(upcoding: Config['thresholds']['upcoding']): Config {
  return { ...config, thresholds: { ...config.thresholds, upcoding } };
}

describe('upcoding', () => {
  it('flags 2,000 in a group of 20 P-1001 claims around 800', () => {
    const claim = makeClaim({ submitted_amount: 2_000 });
    const ctx = buildContext([...claimsOf([...AROUND_800, ...AROUND_800]), claim], config);
    const flag = upcoding(claim, ctx);

    expect(flag?.rule).toBe('upcoding');
    expect(flag?.severity).toBe(config.weights.upcoding);
  });

  it('does not flag 900 in the same group', () => {
    const claim = makeClaim({ submitted_amount: 900 });
    const ctx = buildContext([...claimsOf([...AROUND_800, ...AROUND_800]), claim], config);

    expect(upcoding(claim, ctx)).toBeNull();
    expect(assessUpcoding(claim, ctx)).toMatchObject({ kind: 'scored', others: 20, mean: 800 });
  });

  it('skips a group of only 8 claims and counts every one of them as insufficient data', () => {
    const outlier = makeClaim({ submitted_amount: 5_000 });
    const ctx = buildContext([...claimsOf([700, 750, 800, 850, 900, 800, 750]), outlier], config);

    expect(upcoding(outlier, ctx)).toBeNull();
    expect(assessUpcoding(outlier, ctx)).toEqual({ kind: 'insufficient_data', combo: 'P-1001', others: 7 });
    expect(countUpcodingSkips(ctx)).toEqual({ insufficientData: 8, zeroSd: 0 });
  });

  it('evaluates a claim with exactly 10 other claims and skips one with 9 (Decision 15)', () => {
    const ten = makeClaim({ submitted_amount: 5_000 });
    expect(upcoding(ten, buildContext([...claimsOf(AROUND_800), ten], config))).not.toBeNull();

    const nine = makeClaim({ submitted_amount: 5_000 });
    expect(upcoding(nine, buildContext([...claimsOf(AROUND_800.slice(1)), nine], config))).toBeNull();
  });

  it('handles a group whose other claims all have the same amount (SD = 0) without Infinity or NaN', () => {
    const claim = makeClaim({ submitted_amount: 5_000 });
    const claims = [...claimsOf(Array<number>(11).fill(800)), claim];
    const ctx = buildContext(claims, config);

    expect(() => upcoding(claim, ctx)).not.toThrow();
    expect(upcoding(claim, ctx)).toBeNull();
    expect(assessUpcoding(claim, ctx)).toEqual({ kind: 'zero_sd', combo: 'P-1001', others: 11, mean: 800 });
    for (const c of claims) {
      const assessment = assessUpcoding(c, ctx);
      for (const value of Object.values(assessment)) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
      expect(upcoding(c, ctx)?.evidence ?? '').not.toMatch(/Infinity|NaN/);
    }
    expect(countUpcodingSkips(ctx)).toEqual({ insufficientData: 0, zeroSd: 1 });
  });

  it('treats identical non-integer amounts as SD = 0 despite floating-point residue in the sum of squares', () => {
    // 57 × 34,991.98 leaves a positive residue of about 1e-4 in Σx² − (Σx)²/m, i.e. an SD
    // of about 0.0015 instead of 0. Without a tolerance a claim 500 above would get z ≈ 340,000.
    const claim = makeClaim({ submitted_amount: 35_491.98 });
    const ctx = buildContext([...claimsOf(Array<number>(57).fill(34_991.98)), claim], config);

    expect(assessUpcoding(claim, ctx).kind).toBe('zero_sd');
    expect(upcoding(claim, ctx)).toBeNull();
  });

  it('groups [P-1001, P-1002] apart from [P-1001], whatever the order of the codes', () => {
    const claim = makeClaim({ procedure_codes: ['P-1002', 'P-1001'], submitted_amount: 1_300 });
    const pairAmounts = [1_100, 1_150, 1_200, 1_250, 1_300, 1_100, 1_150, 1_200, 1_250, 1_300, 1_200, 1_200];
    const pair = pairAmounts.map((submitted_amount, i) =>
      makeClaim({ procedure_codes: i % 2 ? ['P-1001', 'P-1002'] : ['P-1002', 'P-1001'], submitted_amount }),
    );
    const ctx = buildContext([...claimsOf([...AROUND_800, ...AROUND_800]), ...pair, claim], config);

    // Against the [P-1001] group (mean 800, SD ≈ 126) 1,300 would be z ≈ 4.
    expect(upcoding(claim, ctx)).toBeNull();
    expect(assessUpcoding(claim, ctx)).toMatchObject({ kind: 'scored', combo: 'P-1001+P-1002', others: 12, mean: 1_200 });
  });

  it('computes leave-one-out mean and sample SD that match a hand calculation (group of 5)', () => {
    // Others of the 1,500 claim: 500, 900, 900, 900.
    //   mean     = (500 + 900 + 900 + 900) / 4 = 3,200 / 4 = 800
    //   Σ(x−m)²  = (−300)² + 3 × 100² = 90,000 + 30,000 = 120,000
    //   variance = 120,000 / (4 − 1) = 40,000          (sample variance)
    //   SD       = √40,000 = 200
    //   z        = (1,500 − 800) / 200 = 3.5
    // Others of one 900 claim: 500, 900, 900, 1,500.
    //   mean     = 3,800 / 4 = 950
    //   Σ(x−m)²  = (−450)² + 2 × (−50)² + 550² = 202,500 + 5,000 + 302,500 = 510,000
    //   variance = 510,000 / 3 = 170,000;  SD = √170,000 ≈ 412.31
    //   z        = (900 − 950) / √170,000 ≈ −0.1213
    const small = withUpcoding({ z_threshold: 2, min_other_claims: 4 });
    const high = makeClaim({ submitted_amount: 1_500 });
    const [low, mid] = claimsOf([500, 900, 900, 900]) as [Claim, Claim];
    const claims = [low, mid, ...claimsOf([900, 900]), high];
    const ctx = buildContext(claims, small);

    expect(assessUpcoding(high, ctx)).toEqual({ kind: 'scored', combo: 'P-1001', others: 4, mean: 800, sd: 200, z: 3.5 });
    const midAssessment = assessUpcoding(mid, ctx);
    expect(midAssessment).toMatchObject({ kind: 'scored', others: 4, mean: 950 });
    if (midAssessment.kind !== 'scored') throw new Error('expected a scored assessment');
    expect(midAssessment.sd).toBeCloseTo(Math.sqrt(170_000), 9);
    expect(midAssessment.z).toBeCloseTo(-50 / Math.sqrt(170_000), 9);

    expect(upcoding(high, ctx)).not.toBeNull();
    // With the default minimum of 10 other claims the same group is skipped.
    expect(upcoding(high, buildContext(claims, config))).toBeNull();
  });

  it('agrees with the two-pass leaveOneOutStats for every claim of an irregular group', () => {
    const amounts = [512, 733, 845, 910, 1_022, 650, 799, 801, 1_200, 640, 777, 888, 999, 555, 1_500];
    const claims = claimsOf(amounts);
    const ctx = buildContext(claims, config);

    claims.forEach((claim, i) => {
      const reference = leaveOneOutStats(amounts, i, config.thresholds.upcoding.min_other_claims);
      const assessment = assessUpcoding(claim, ctx);
      if (assessment.kind !== 'scored' || !reference) throw new Error(`claim ${i} was not scored`);
      expect(assessment.others).toBe(reference.n);
      expect(assessment.mean).toBeCloseTo(reference.mean, 9);
      expect(assessment.sd).toBeCloseTo(reference.sd, 9);
    });
  });

  it('does not flag z exactly 2 (the rule is z > 2), but flags 1 above', () => {
    // Others: 500, 1,100, 500, 1,100 and six × 800 → mean 800,
    // Σ(x−m)² = 4 × 300² = 360,000, variance = 360,000 / 9 = 40,000, SD = 200.
    // 1,200 is (1,200 − 800) / 200 = exactly 2; 1,201 is 2.005.
    const others = [500, 1_100, 500, 1_100, 800, 800, 800, 800, 800, 800];
    const atTwo = makeClaim({ submitted_amount: 1_200 });
    const ctxAtTwo = buildContext([...claimsOf(others), atTwo], config);
    expect(assessUpcoding(atTwo, ctxAtTwo)).toMatchObject({ kind: 'scored', mean: 800, sd: 200, z: 2 });
    expect(upcoding(atTwo, ctxAtTwo)).toBeNull();

    const above = makeClaim({ submitted_amount: 1_201 });
    expect(upcoding(above, buildContext([...claimsOf(others), above], config))).not.toBeNull();
  });

  it('does not flag amounts far below the mean', () => {
    const claim = makeClaim({ submitted_amount: 10 });
    expect(upcoding(claim, buildContext([...claimsOf([...AROUND_800, ...AROUND_800]), claim], config))).toBeNull();
  });

  it('puts the amount, combination, mean, SD, other-claim count and z in the evidence', () => {
    const small = withUpcoding({ z_threshold: 2, min_other_claims: 4 });
    const high = makeClaim({ submitted_amount: 1_500 });
    const evidence = upcoding(high, buildContext([...claimsOf([500, 900, 900, 900]), high], small))?.evidence ?? '';

    for (const part of ['1,500', 'P-1001', 'mean 800', 'SD 200', '4 other claims', 'excluding this claim', 'z = 3.50', '> 2']) {
      expect(evidence).toContain(part);
    }
  });
});
