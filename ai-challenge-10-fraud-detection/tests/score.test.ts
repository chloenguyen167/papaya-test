import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { readClaims } from '../src/csv.js';
import { runRules, type ClaimFlags } from '../src/engine.js';
import { priorityOf, rankedToCsv, riskScore, scoreClaims, toScoredJson } from '../src/score.js';
import type { Config, Flag, RuleName } from '../src/types.js';
import { makeClaim } from './helpers.js';

const root = join(import.meta.dirname, '..');
const config = loadConfig(join(root, 'config'));
const scoring = config.scoring;

const flag = (rule: RuleName, severity: number): Flag => ({ rule, severity, evidence: `test evidence ${severity}` });

describe('riskScore', () => {
  it('maps raw severity sums with saturation 4 to the documented scores', () => {
    expect(scoring.saturation).toBe(4);
    // 100 × (1 − e^(−raw/4)): 39.3, 52.8, 63.2, 71.3, 77.7
    expect([2, 3, 4, 5, 6].map((raw) => riskScore(raw, 4))).toEqual([39, 53, 63, 71, 78]);
  });

  it('is 0 only when no rule fired', () => {
    expect(riskScore(0, 4)).toBe(0);
    // 100 × (1 − e^(−1/1000)) = 0.1 would round to 0; a flagged claim is floored at 1.
    expect(riskScore(1, 1000)).toBe(1);
  });

  it('never decreases and never exceeds 100', () => {
    const scores = Array.from({ length: 41 }, (_, raw) => riskScore(raw, 4));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1] as number);
    expect(Math.max(...scores)).toBe(100);
    expect(riskScore(1e6, 4)).toBe(100);
  });
});

describe('priorityOf', () => {
  it('uses High ≥ 70, Medium 50–69, Low 1–49 and None for 0', () => {
    const cases: [number, string][] = [[0, 'None'], [1, 'Low'], [49, 'Low'], [50, 'Medium'], [69, 'Medium'], [70, 'High'], [100, 'High']];
    for (const [score, priority] of cases) expect([score, priorityOf(score, scoring)]).toEqual([score, priority]);
  });

  it('takes the cut-offs from config', () => {
    const custom = { ...scoring, high_priority_min: 80, medium_priority_min: 30 };
    expect([29, 30, 79, 80].map((s) => priorityOf(s, custom))).toEqual(['Low', 'Medium', 'Medium', 'High']);
  });
});

describe('scoreClaims', () => {
  const results: ClaimFlags[] = [
    { claim_id: 'CLM-00003', flags: [flag('upcoding', 4)] },
    { claim_id: 'CLM-00001', flags: [flag('dx_procedure_mismatch', 2), flag('amount_clustering', 2)] },
    { claim_id: 'CLM-00002', flags: [] },
    { claim_id: 'CLM-00004', flags: [flag('duplicate_claim', 5)] },
  ];
  const ranked = scoreClaims(results, scoring);

  it('sums flag severities, ranks by score descending and breaks ties by claim_id ascending', () => {
    expect(ranked.map((c) => [c.claim_id, c.risk_score, c.priority])).toEqual([
      ['CLM-00004', 71, 'High'],
      ['CLM-00001', 63, 'Medium'],
      ['CLM-00003', 63, 'Medium'],
      ['CLM-00002', 0, 'None'],
    ]);
  });

  it('breaks ties by the numeric part of claim_id', () => {
    const tied = scoreClaims(
      [
        { claim_id: 'CLM-10', flags: [flag('upcoding', 4)] },
        { claim_id: 'CLM-9', flags: [flag('upcoding', 4)] },
      ],
      scoring,
    );
    expect(tied.map((c) => c.claim_id)).toEqual(['CLM-9', 'CLM-10']);
  });

  it('scores with the severity the rules took from the config weights', () => {
    const pair = { member_id: 'M-01', claim_date: '2024-03-13' };
    const claims = [makeClaim({ ...pair, claim_id: 'CLM-01' }), makeClaim({ ...pair, claim_id: 'CLM-02' })];
    const withWeight = (w: number): Config => ({ ...config, weights: { ...config.weights, duplicate_claim: w } });
    const scoreOfCopy = (c: Config): number | undefined =>
      scoreClaims(runRules(claims, c), c.scoring).find((r) => r.claim_id === 'CLM-02')?.risk_score;

    expect(scoreOfCopy(withWeight(5))).toBe(71);
    expect(scoreOfCopy(withWeight(1))).toBe(22);
  });

  it('writes only flagged claims to scored.json, with exactly the brief’s keys', () => {
    const scored = toScoredJson(ranked);
    expect(scored.map((c) => c.claim_id)).toEqual(['CLM-00004', 'CLM-00001', 'CLM-00003']);
    for (const c of scored) expect(Object.keys(c)).toEqual(['claim_id', 'risk_score', 'flags']);
    expect(scored[1]?.flags).toEqual([flag('dx_procedure_mismatch', 2), flag('amount_clustering', 2)]);
  });

  it('writes every claim to ranked.csv with its priority and rule names', () => {
    expect(rankedToCsv(ranked).split('\r\n')).toEqual([
      'claim_id,risk_score,priority,rules',
      'CLM-00004,71,High,duplicate_claim',
      'CLM-00001,63,Medium,dx_procedure_mismatch|amount_clustering',
      'CLM-00003,63,Medium,upcoding',
      'CLM-00002,0,None,',
      '',
    ]);
  });
});

describe('scoring the shipped dataset', () => {
  const claims = readClaims(join(root, 'data', 'claims.csv'));
  const start = performance.now();
  const ranked = scoreClaims(runRules(claims, config), scoring);
  const elapsed = performance.now() - start;

  it('scores all 2,000 claims in under 30 s', () => {
    expect(ranked).toHaveLength(2_000);
    expect(elapsed).toBeLessThan(30_000);
  });

  it('gives a score > 0 exactly to the claims with a flag, computed from the config weights', () => {
    for (const c of ranked) {
      const raw = c.flags.reduce((sum, f) => sum + config.weights[f.rule], 0);
      expect(c.risk_score).toBe(riskScore(raw, scoring.saturation));
      expect(c.risk_score > 0).toBe(c.flags.length > 0);
    }
  });
});
