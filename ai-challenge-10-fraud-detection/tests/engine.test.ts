import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runRules } from '../src/engine.js';
import { RULES } from '../src/rules/index.js';
import { RULE_NAMES, type Claim, type Config, type RuleName } from '../src/types.js';
import { makeClaim } from './helpers.js';

const baseConfig = loadConfig(join(import.meta.dirname, '..', 'config'));

/**
 * Real groups need 10+ other claims for upcoding and 20+ surgical claims for the
 * weekend rule, which would make a hand-built scenario huge. The two minimums are
 * lowered so 13 claims exercise the same code paths; every other threshold is the
 * configured one. Phantom billing (> 30 claims in a day) is left to its unit tests.
 */
const config: Config = {
  ...baseConfig,
  thresholds: {
    ...baseConfig.thresholds,
    upcoding: { ...baseConfig.thresholds.upcoding, min_other_claims: 2 },
    weekend_anomaly: { ...baseConfig.thresholds.weekend_anomaly, min_provider_claims: 4 },
  },
};

const clinic = { provider_id: 'PRV-01', provider_name: 'City Clinic' };
const hospital = { provider_id: 'PRV-02', provider_name: 'General Hospital', claim_type: 'INPATIENT' } as const;

/** Procedure combination [P-1001] under J06.9: amounts 700, 800, 900, 800 and the 2,000 outlier. */
const base1 = makeClaim({ ...clinic, claim_id: 'CLM-01', member_id: 'M-01', claim_date: '2024-03-06', submitted_amount: 700 });
const clean2 = makeClaim({ ...clinic, claim_id: 'CLM-02', member_id: 'M-02', claim_date: '2024-03-07', submitted_amount: 800 });
const clean3 = makeClaim({ ...clinic, claim_id: 'CLM-03', member_id: 'M-03', claim_date: '2024-03-11', submitted_amount: 900 });
const upcoded = makeClaim({ ...clinic, claim_id: 'CLM-04', member_id: 'M-04', claim_date: '2024-03-12', submitted_amount: 2_000 });
/** Same member and diagnosis as CLM-01, two days later. */
const rapid = makeClaim({ ...clinic, claim_id: 'CLM-05', member_id: 'M-01', claim_date: '2024-03-08', submitted_amount: 800 });

/** Duplicate pair: identical in member, provider, date, diagnosis. Gap 0, so rapid must stay off. */
const pair = { ...clinic, member_id: 'M-05', claim_date: '2024-03-13', diagnosis_code: 'N39.0', procedure_codes: ['P-1001', 'P-1005'], submitted_amount: 1_100 };
const original = makeClaim({ ...pair, claim_id: 'CLM-06' });
const copy = makeClaim({ ...pair, claim_id: 'CLM-07' });

/** K35.80 [P-1008, B-9002] at a hospital: 38,000, 40,000 and 48,000 (in the 47,500–49,999 band, z ≈ 6.4). */
const appendix = { ...hospital, diagnosis_code: 'K35.80', procedure_codes: ['P-1008', 'B-9002'] };
const surgery1 = makeClaim({ ...appendix, claim_id: 'CLM-08', member_id: 'M-06', claim_date: '2024-03-04', submitted_amount: 38_000 });
const surgery2 = makeClaim({ ...appendix, claim_id: 'CLM-09', member_id: 'M-07', claim_date: '2024-03-05', submitted_amount: 40_000 });
const clustered = makeClaim({ ...appendix, claim_id: 'CLM-10', member_id: 'M-08', claim_date: '2024-03-06', submitted_amount: 48_000 });

/** Sunday fracture surgery at the hospital, whose other 3 surgical claims are all on weekdays. */
const weekend = makeClaim({
  ...hospital,
  claim_id: 'CLM-11',
  member_id: 'M-09',
  claim_date: '2024-03-17',
  diagnosis_code: 'S52.50',
  procedure_codes: ['P-1006', 'P-2004', 'P-2002'],
  submitted_amount: 64_200,
});

/** Blood panel B-9001 billed as its three components. */
const split = makeClaim({
  ...clinic,
  claim_id: 'CLM-12',
  member_id: 'M-10',
  claim_date: '2024-03-14',
  diagnosis_code: 'E11.9',
  procedure_codes: ['P-1002', 'P-1003', 'P-1004'],
  submitted_amount: 1_200,
});

/** A cold (J06.9) billed with a tooth extraction. */
const mismatch = makeClaim({
  ...clinic,
  claim_id: 'CLM-13',
  member_id: 'M-11',
  claim_date: '2024-03-15',
  procedure_codes: ['P-1001', 'P-3004'],
  submitted_amount: 2_000,
});

const claims: Claim[] = [base1, clean2, clean3, upcoded, rapid, original, copy, surgery1, surgery2, clustered, weekend, split, mismatch];

/** The rules that must fire on each claim; every claim not listed must have no flags. */
const EXPECTED: Record<string, RuleName[]> = {
  'CLM-04': ['upcoding'],
  'CLM-05': ['rapid_resubmission'],
  'CLM-07': ['duplicate_claim'],
  'CLM-10': ['upcoding', 'amount_clustering'],
  'CLM-11': ['weekend_anomaly'],
  'CLM-12': ['unbundling'],
  'CLM-13': ['dx_procedure_mismatch'],
};

describe('RULES', () => {
  it('has 8 distinct rules, one per rule name', () => {
    expect(RULES).toHaveLength(RULE_NAMES.length);
    expect(new Set(RULES).size).toBe(RULE_NAMES.length);
  });
});

describe('runRules on 13 hand-built claims', () => {
  const results = runRules(claims, config);
  const flagsOf = (claim: Claim) => results.find((r) => r.claim_id === claim.claim_id)?.flags ?? [];
  const rulesOf = (claim: Claim): RuleName[] => flagsOf(claim).map((f) => f.rule);

  it('returns one entry per claim, in input order', () => {
    expect(results.map((r) => r.claim_id)).toEqual(claims.map((c) => c.claim_id));
  });

  it('fires exactly the expected rules on every claim and nothing else', () => {
    const actual = Object.fromEntries(results.map((r) => [r.claim_id, r.flags.map((f) => f.rule).sort()]));
    const expected = Object.fromEntries(claims.map((c) => [c.claim_id, [...(EXPECTED[c.claim_id] ?? [])].sort()]));
    expect(actual).toEqual(expected);
  });

  it('flags only the later copy of the duplicate pair, and rapid resubmission stays off on both', () => {
    expect(rulesOf(original)).toEqual([]);
    expect(rulesOf(copy)).toEqual(['duplicate_claim']);
    expect(rulesOf(copy)).not.toContain('rapid_resubmission');
  });

  it('fires upcoding and amount clustering together on the 48,000 claim, in RULE_NAMES order', () => {
    expect(rulesOf(clustered)).toEqual(['upcoding', 'amount_clustering']);
    expect(flagsOf(clustered).map((f) => f.severity)).toEqual([config.weights.upcoding, config.weights.amount_clustering]);
  });

  it('leaves the clean claims without any flag', () => {
    for (const claim of [base1, clean2, clean3, original, surgery1, surgery2]) expect(flagsOf(claim)).toEqual([]);
  });

  it('gives every flag evidence that contains digits and the rule’s own severity', () => {
    for (const { flags } of results) {
      for (const flag of flags) {
        expect(flag.evidence).toMatch(/\d/);
        expect(flag.severity).toBe(config.weights[flag.rule]);
      }
    }
  });

  it('returns an empty list for an empty dataset', () => {
    expect(runRules([], config)).toEqual([]);
  });
});
