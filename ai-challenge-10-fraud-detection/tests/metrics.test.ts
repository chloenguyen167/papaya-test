import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { readClaims } from '../src/csv.js';
import { runRules } from '../src/engine.js';
import {
  binaryMetrics,
  computeMetrics,
  labelsFromCsv,
  precisionAtK,
  ratio,
  gapPp,
  renderComparison,
  renderMarkdown,
  scoredFromJson,
  summarize,
  summaryFromJson,
  upsertComparison,
  COMPARISON_END,
  COMPARISON_START,
  type RunSummary,
  statsFromJson,
  summaryLines,
  SWEEP_THRESHOLDS,
  thresholdSweep,
  TARGETS,
} from '../src/metrics.js';
import { scoreClaims, toScoredJson, type ScoreStats } from '../src/score.js';
import type { Flag, FraudLabel, RuleName, ScoredClaim } from '../src/types.js';

const root = join(import.meta.dirname, '..');
const flag = (rule: RuleName, severity: number): Flag => ({ rule, severity, evidence: `test evidence ${severity}` });

/**
 * 10 claims: 4 fraud (01 duplicate, 02 and 03 upcoding, 04 clustering), 6 clean.
 * Flagged: 04 (78, also fires upcoding), 01 (71), 02 (63), 05 (63, clean), 06 (22, clean).
 * Headline: TP 3 (01, 02, 04), FP 2 (05, 06), FN 1 (03), TN 4 (07–10).
 */
const labels: FraudLabel[] = [
  { claim_id: 'CLM-01', fraud_type: 'duplicate_claim' },
  { claim_id: 'CLM-02', fraud_type: 'upcoding' },
  { claim_id: 'CLM-03', fraud_type: 'upcoding' },
  { claim_id: 'CLM-04', fraud_type: 'amount_clustering' },
  ...['05', '06', '07', '08', '09', '10'].map((n): FraudLabel => ({ claim_id: `CLM-${n}`, fraud_type: 'clean' })),
];
const scored: ScoredClaim[] = [
  { claim_id: 'CLM-04', risk_score: 78, flags: [flag('upcoding', 4), flag('amount_clustering', 2)] },
  { claim_id: 'CLM-01', risk_score: 71, flags: [flag('duplicate_claim', 5)] },
  { claim_id: 'CLM-05', risk_score: 63, flags: [flag('upcoding', 4)] },
  { claim_id: 'CLM-02', risk_score: 63, flags: [flag('upcoding', 4)] },
  { claim_id: 'CLM-06', risk_score: 22, flags: [flag('phantom_billing', 1)] },
];
const stats: ScoreStats = {
  claims: 10,
  flagged: 5,
  scoring_ms: 12.3,
  total_ms: 20.5,
  upcoding_skipped: { min_other_claims: 10, insufficient_data: 7, zero_sd: 0 },
};
const scores = new Map(scored.map((c) => [c.claim_id, c.risk_score]));
const fraudIds = new Set(['CLM-01', 'CLM-02', 'CLM-03', 'CLM-04']);
const sources = { scored: 'output/scored.json', labels: 'data/labels.csv' };

describe('ratio', () => {
  it('returns null instead of dividing by 0', () => {
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(3, 0)).toBeNull();
  });
});

describe('headline metrics at score > 0', () => {
  const m = computeMetrics(scored, labels, stats);

  it('builds the confusion matrix and the four rates', () => {
    expect(m.headline).toMatchObject({ tp: 3, fp: 2, fn: 1, tn: 4, flagged: 5 });
    expect(m.headline.precision).toBeCloseTo(3 / 5);
    expect(m.headline.recall).toBeCloseTo(3 / 4);
    expect(m.headline.f1).toBeCloseTo(6 / 9);
  });

  it('divides FPR by the clean claims (6), not by all claims (10)', () => {
    expect(m.headline.fpr).toBeCloseTo(2 / 6);
  });

  it('reports n/a, never NaN or Infinity, when a denominator is 0', () => {
    const allClean: FraudLabel[] = [{ claim_id: 'CLM-01', fraud_type: 'clean' }];
    const none = computeMetrics([], allClean, { ...stats, claims: 1, flagged: 0 });
    expect(none.headline).toMatchObject({ precision: null, recall: null, fpr: 0, f1: null });

    const empty = computeMetrics([], [], { ...stats, claims: 0, flagged: 0 });
    expect(empty.headline).toMatchObject({ precision: null, recall: null, fpr: null, f1: null });
    expect(empty.precisionAtK.every((p) => p.precision === null && p.scoreAtCutoff === null)).toBe(true);
    expect(empty.rules.every((r) => r.precision === null && r.ownRecall === null)).toBe(true);

    for (const metrics of [none, empty]) {
      const text = renderMarkdown(metrics, sources) + summaryLines(metrics).join('\n');
      expect(text).not.toMatch(/NaN|Infinity/);
      expect(text).toContain('n/a');
    }
  });

  it('gives F1 = 0, not n/a, when nothing is caught but there is fraud', () => {
    const missed = binaryMetrics([{ claim_id: 'CLM-01', fraud_type: 'upcoding' }], () => false);
    expect(missed).toMatchObject({ precision: null, recall: 0, f1: 0 });
  });
});

describe('thresholdSweep', () => {
  it('uses thresholds 1, 10, 20, …, 90, and t = 1 equals the headline', () => {
    const sweep = thresholdSweep(scores, labels);
    expect(sweep.map((r) => r.threshold)).toEqual([...SWEEP_THRESHOLDS]);
    expect(SWEEP_THRESHOLDS).toEqual([1, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
    const { threshold, ...atOne } = sweep[0]!;
    expect(threshold).toBe(1);
    expect(atOne).toEqual(computeMetrics(scored, labels, stats).headline);
  });

  it('flags a claim when its score is ≥ t', () => {
    const [at63, at64] = thresholdSweep(scores, labels, [63, 64]);
    expect(at63).toMatchObject({ flagged: 4, tp: 3, fp: 1 });
    expect(at64).toMatchObject({ flagged: 2, tp: 2, fp: 0 });
  });
});

describe('precisionAtK', () => {
  it('ranks by score, breaking the 63 tie by claim_id, so CLM-02 comes before CLM-05', () => {
    expect(precisionAtK(scored, fraudIds, 3)).toEqual({ k: 3, considered: 3, fraud: 3, precision: 1, scoreAtCutoff: 63 });
    expect(precisionAtK(scored, fraudIds, 4)).toMatchObject({ fraud: 3, precision: 0.75 });
  });

  it('uses all flagged claims when fewer than K are flagged', () => {
    expect(precisionAtK(scored, fraudIds, 50)).toEqual({ k: 50, considered: 5, fraud: 3, precision: 0.6, scoreAtCutoff: 22 });
  });
});

describe('per-rule and per-pattern breakdown', () => {
  const m = computeMetrics(scored, labels, stats);
  const rule = (name: RuleName) => m.rules.find((r) => r.rule === name);
  const pattern = (name: RuleName) => m.patterns.find((p) => p.pattern === name);

  it('counts fraud of any type for rule precision, but only its own pattern for rule recall', () => {
    // upcoding fires on 04 (clustering fraud), 05 (clean) and 02 (upcoding fraud); misses 03.
    expect(rule('upcoding')).toMatchObject({ fires: 3, fraud: 2, ownLabeled: 2, ownCaught: 1 });
    expect(rule('upcoding')?.precision).toBeCloseTo(2 / 3);
    expect(rule('upcoding')?.ownRecall).toBe(0.5);
    expect(rule('amount_clustering')).toMatchObject({ fires: 1, fraud: 1, precision: 1, ownRecall: 1 });
  });

  it('reports n/a for a rule that never fires and has no labeled pattern', () => {
    expect(rule('weekend_anomaly')).toMatchObject({ fires: 0, precision: null, ownLabeled: 0, ownRecall: null });
    expect(rule('phantom_billing')).toMatchObject({ fires: 1, fraud: 0, precision: 0, ownRecall: null });
  });

  it('computes engine recall per fraud pattern from score > 0', () => {
    expect(pattern('upcoding')).toEqual({ pattern: 'upcoding', labeled: 2, caught: 1, recall: 0.5 });
    expect(pattern('duplicate_claim')).toMatchObject({ labeled: 1, caught: 1, recall: 1 });
    expect(pattern('weekend_anomaly')).toMatchObject({ labeled: 0, recall: null });
  });
});

describe('computeMetrics consistency checks', () => {
  it('rejects a scored claim without a label', () => {
    const extra = [...scored, { claim_id: 'CLM-99', risk_score: 39, flags: [flag('upcoding', 4)] }];
    expect(() => computeMetrics(extra, labels, { ...stats, flagged: 6 })).toThrow('CLM-99 has no label');
  });

  it('rejects stats from a run over a different number of claims', () => {
    expect(() => computeMetrics(scored, labels, { ...stats, claims: 2_000 })).toThrow('2000 scored claims but labels.csv has 10');
    expect(() => computeMetrics(scored, labels, { ...stats, flagged: 4 })).toThrow('4 flagged claims');
  });

  it('rejects a claim listed twice in scored.json', () => {
    expect(() => computeMetrics([...scored, scored[0]!], labels, { ...stats, flagged: 6 })).toThrow('CLM-04 appears twice');
  });
});

describe('input parsing', () => {
  it('reads labels.csv and rejects bad rows', () => {
    expect(labelsFromCsv('claim_id,fraud_type\r\nCLM-01,clean\r\nCLM-02,upcoding\r\n')).toEqual([
      { claim_id: 'CLM-01', fraud_type: 'clean' },
      { claim_id: 'CLM-02', fraud_type: 'upcoding' },
    ]);
    expect(() => labelsFromCsv('id,type\nCLM-01,clean\n')).toThrow('header');
    expect(() => labelsFromCsv('claim_id,fraud_type\nCLM-01,fraud\n')).toThrow('got "fraud"');
    expect(() => labelsFromCsv('claim_id,fraud_type\nCLM-01,clean\nCLM-01,upcoding\n')).toThrow('duplicate claim_id CLM-01');
  });

  it('reads scored.json and rejects unknown rules, score 0 and empty flags', () => {
    expect(scoredFromJson(JSON.stringify(scored))).toEqual(scored);
    const bad = (claim: object) => () => scoredFromJson(JSON.stringify([claim]));
    expect(bad({ claim_id: 'CLM-01', risk_score: 39, flags: [{ rule: 'typo', severity: 2, evidence: 'x' }] })).toThrow('unknown rule');
    expect(bad({ claim_id: 'CLM-01', risk_score: 0, flags: [flag('upcoding', 4)] })).toThrow('risk_score');
    expect(bad({ claim_id: 'CLM-01', risk_score: 39, flags: [] })).toThrow('flags');
  });

  it('reads score-stats.json', () => {
    expect(statsFromJson(JSON.stringify(stats))).toEqual(stats);
    expect(() => statsFromJson('{"claims": 1}')).toThrow('unexpected shape');
  });
});

describe('report output', () => {
  const m = computeMetrics(scored, labels, stats);

  it('prints a 5-line summary with claims, flagged, precision, recall, FPR and time', () => {
    const lines = summaryLines(m);
    expect(lines).toHaveLength(5);
    expect(lines.join('\n')).toMatch(/10 .*4 labeled fraud.*6 clean/);
    expect(lines[1]).toContain('5');
    expect(lines[2]).toMatch(/60\.0%.*75\.0%/);
    expect(lines[3]).toContain('33.3%');
    expect(lines[4]).toContain('12.3 ms');
  });

  it('writes every required section to metrics.md', () => {
    const md = renderMarkdown(m, sources);
    for (const heading of ['## Headline', '## Threshold sweep', '## Precision@K', '## Per rule', '## Engine recall by fraud pattern', '## Upcoding coverage', '## Performance']) {
      expect(md).toContain(heading);
    }
    expect(md).toContain('| **Flagged** | TP 3 | FP 2 | 5 |');
    expect(md).toContain('**7** claims');
    expect(md).toContain('**12.3 ms**');
  });
});

describe('seed comparison', () => {
  const base: RunSummary = {
    seed: 42, config_hash: 'abc', claims: 2000, fraud: 200, flagged: 252,
    precision: 0.794, recall: 1, fpr: 0.029, f1: 0.885, precision_at_100: 0.79,
  };
  const other: RunSummary = { ...base, seed: 7, flagged: 249, precision: 0.803, fpr: 0.027, f1: 0.891, precision_at_100: 0.8 };

  it('summarizes a run, with precision@100 taken from the K = 100 row', () => {
    const m = computeMetrics(scored, labels, stats, 42);
    const summary = summarize(m, 'abc');
    expect(summary).toMatchObject({ seed: 42, config_hash: 'abc', claims: 10, fraud: 4, flagged: 5, recall: 0.75 });
    expect(summary.precision_at_100).toBe(m.precisionAtK.find((p) => p.k === 100)?.precision);
    expect(summaryFromJson(JSON.stringify(summary))).toEqual(summary);
    expect(() => summaryFromJson('{"seed": 1}')).toThrow('config_hash');
  });

  it('gapPp is the difference in percentage points and null when a side is missing', () => {
    expect(gapPp(0.5, 0.56)).toBeCloseTo(6);
    expect(gapPp(null, 0.5)).toBeNull();
  });

  it('lists the five metrics, signed differences, and says when nothing differs by more than 5 pp', () => {
    const md = renderComparison(base, other);
    expect(md).toContain('| Metric | seed 42 | seed 7 | Difference |');
    for (const row of ['Precision', 'Recall', 'FPR', 'F1', 'Precision@100']) expect(md).toContain(`| ${row} |`);
    expect(md).toContain('| Precision | 79.4% | 80.3% | +0.9 pp |');
    expect(md).toContain('| FPR | 2.9% | 2.7% | −0.2 pp |');
    expect(md).toContain('No metric differs by more than 5 pp.');
    expect(md).not.toContain('Warning');
  });

  it('marks the metrics that differ by more than 5 pp, but not exactly 5', () => {
    const md = renderComparison(base, { ...other, recall: 0.9, fpr: base.fpr! + 0.05 });
    expect(md).toContain('| Recall | 100.0% | 90.0% | **−10.0 pp (> 5 pp)** |');
    expect(md).toContain('Gaps above 5 pp: Recall.');
    expect(md).not.toContain('| FPR | 2.9% | 7.9% | **');
  });

  it('shows n/a, never NaN, when a metric is undefined, and warns when the config differs', () => {
    const md = renderComparison(base, { ...other, precision: null, config_hash: 'xyz' });
    expect(md).toContain('| Precision | 79.4% | n/a | n/a |');
    expect(md).toContain('**Warning:** the config differs');
    expect(md).not.toMatch(/NaN|Infinity/);
  });

  it('upsertComparison inserts under the title and replaces on a second call', () => {
    const md = '# Metrics report\n\nbody\n';
    const once = upsertComparison(md, 'FIRST');
    expect(once).toBe(`# Metrics report\n\n${COMPARISON_START}\nFIRST\n${COMPARISON_END}\n\nbody\n`);
    const twice = upsertComparison(once, 'SECOND');
    expect(twice).toBe(once.replace('FIRST', 'SECOND'));
    expect(twice.split(COMPARISON_START)).toHaveLength(2);
  });
});

describe('label isolation', () => {
  const srcFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? srcFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
    );
  const files = srcFiles(join(root, 'src')).map((f) => ({ path: relative(root, f), text: readFileSync(f, 'utf8') }));

  it('lets only metrics.ts read labels.csv; the generator only writes it', () => {
    expect(files.filter((f) => f.text.includes('labels.csv')).map((f) => f.path).sort()).toEqual(['src/generate/generate.ts', 'src/metrics.ts']);
    // The pipeline only passes the labels path to runReport; it never opens the file.
    expect(files.filter((f) => /from '\.\.?\/(\.\.\/)*metrics\.js'/.test(f.text)).map((f) => f.path)).toEqual(['src/pipeline.ts']);
  });

  it('keeps fraud labels out of the rules, the engine and the scorer', () => {
    const scoringPath = files.filter((f) => /^src\/(rules\/|engine\.ts|context\.ts|score\.ts)/.test(f.path));
    expect(scoringPath.length).toBeGreaterThan(8);
    for (const f of scoringPath) expect([f.path, /fraud_type|FraudLabel/.test(f.text)]).toEqual([f.path, false]);
  });
});

describe('the shipped dataset', () => {
  it(`meets the brief's targets: recall ≥ ${TARGETS.minRecall}, FPR ≤ ${TARGETS.maxFpr}`, () => {
    const config = loadConfig(join(root, 'config'));
    const claims = readClaims(join(root, 'data', 'claims.csv'));
    const scoredClaims = toScoredJson(scoreClaims(runRules(claims, config), config.scoring));
    const shippedLabels = labelsFromCsv(readFileSync(join(root, 'data', 'labels.csv'), 'utf8'));
    const m = computeMetrics(scoredClaims, shippedLabels, { ...stats, claims: claims.length, flagged: scoredClaims.length });
    expect(m.headline.recall).toBeGreaterThanOrEqual(TARGETS.minRecall);
    expect(m.headline.fpr).toBeLessThanOrEqual(TARGETS.maxFpr);
  });
});
