/**
 * `npm run report`: compares the scored output with the fraud labels and writes
 * metrics.md. This is the only module that reads labels.csv; the rules, the engine
 * and the scorer never see labels.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEntryPoint, parseFlags } from './cli.js';
import { configFingerprint } from './config.js';
import { parseCsv } from './csv.js';
import { formatNumber } from './format.js';
import { compareRanked, OUTPUT_FILES, type ScoreStats } from './score.js';
import { RULE_NAMES, type Flag, type FraudLabel, type RuleName, type ScoredClaim } from './types.js';

export const LABEL_COLUMNS = ['claim_id', 'fraud_type'] as const;
/** A claim is flagged at threshold t when its score is ≥ t. t = 1 is the headline "score > 0" (Decision 9). */
export const SWEEP_THRESHOLDS = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90] as const;
export const PRECISION_AT_K = [50, 100, 200] as const;
/** Targets from the brief. */
export const TARGETS = { minRecall: 0.7, maxFpr: 0.2 } as const;

type FraudType = FraudLabel['fraud_type'];

/** numerator / denominator, or null when the denominator is 0. Every rate in this module goes through it. */
export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function isRuleName(value: unknown): value is RuleName {
  return typeof value === 'string' && (RULE_NAMES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function labelsFromCsv(text: string): FraudLabel[] {
  const [header, ...records] = parseCsv(text.replace(/^﻿/, ''));
  if (!header || header.join(',') !== LABEL_COLUMNS.join(',')) {
    throw new Error(`labels CSV header must be: ${LABEL_COLUMNS.join(',')}`);
  }
  const seen = new Set<string>();
  return records.map((row, i) => {
    const where = `labels CSV record ${i + 1}`;
    const [claim_id, fraud_type] = row;
    if (row.length !== LABEL_COLUMNS.length || claim_id === undefined || fraud_type === undefined) {
      throw new Error(`${where}: expected ${LABEL_COLUMNS.length} fields, got ${row.length}`);
    }
    if (claim_id === '') throw new Error(`${where}: empty claim_id`);
    if (seen.has(claim_id)) throw new Error(`${where}: duplicate claim_id ${claim_id}`);
    seen.add(claim_id);
    if (fraud_type !== 'clean' && !isRuleName(fraud_type)) {
      throw new Error(`${where}: fraud_type must be "clean" or a rule name, got "${fraud_type}"`);
    }
    return { claim_id, fraud_type };
  });
}

function parseFlag(value: unknown, where: string): Flag {
  if (!isRecord(value)) throw new Error(`${where}: must be an object`);
  const { rule, severity, evidence } = value;
  if (!isRuleName(rule)) throw new Error(`${where}.rule: unknown rule ${JSON.stringify(rule)}`);
  if (typeof severity !== 'number' || !Number.isFinite(severity)) throw new Error(`${where}.severity: must be a number`);
  if (typeof evidence !== 'string' || evidence === '') throw new Error(`${where}.evidence: must be a non-empty string`);
  return { rule, severity, evidence };
}

/** Parses scored.json, which holds flagged claims only, so every score is 1–100 with at least one flag. */
export function scoredFromJson(text: string): ScoredClaim[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error(`${OUTPUT_FILES.scored}: must be an array`);
  return data.map((entry: unknown, i): ScoredClaim => {
    const where = `${OUTPUT_FILES.scored} [${i}]`;
    if (!isRecord(entry)) throw new Error(`${where}: must be an object`);
    const { claim_id, risk_score, flags } = entry;
    if (typeof claim_id !== 'string' || claim_id === '') throw new Error(`${where}.claim_id: must be a non-empty string`);
    if (typeof risk_score !== 'number' || !Number.isInteger(risk_score) || risk_score < 1 || risk_score > 100) {
      throw new Error(`${where}.risk_score: must be an integer from 1 to 100, got ${JSON.stringify(risk_score)}`);
    }
    if (!Array.isArray(flags) || flags.length === 0) throw new Error(`${where}.flags: must be a non-empty array`);
    return { claim_id, risk_score, flags: flags.map((f: unknown, j) => parseFlag(f, `${where}.flags[${j}]`)) };
  });
}

export function statsFromJson(text: string): ScoreStats {
  const data: unknown = JSON.parse(text);
  const where = OUTPUT_FILES.stats;
  if (!isRecord(data) || !isRecord(data['upcoding_skipped'])) throw new Error(`${where}: unexpected shape`);
  const num = (obj: Record<string, unknown>, key: string): number => {
    const value = obj[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${where}: ${key} must be a number >= 0`);
    return value;
  };
  const skipped = data['upcoding_skipped'];
  return {
    claims: num(data, 'claims'),
    flagged: num(data, 'flagged'),
    scoring_ms: num(data, 'scoring_ms'),
    total_ms: num(data, 'total_ms'),
    upcoding_skipped: {
      min_other_claims: num(skipped, 'min_other_claims'),
      insufficient_data: num(skipped, 'insufficient_data'),
      zero_sd: num(skipped, 'zero_sd'),
    },
  };
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface BinaryMetrics {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  flagged: number;
  /** TP / (TP + FP) */
  precision: number | null;
  /** TP / (TP + FN) */
  recall: number | null;
  /** FP / (FP + TN): the denominator is the number of clean claims, not all claims. */
  fpr: number | null;
  /** 2TP / (2TP + FP + FN), equal to the harmonic mean of precision and recall. */
  f1: number | null;
}

export function binaryMetrics(labels: readonly FraudLabel[], isFlagged: (claimId: string) => boolean): BinaryMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const { claim_id, fraud_type } of labels) {
    const fraud = fraud_type !== 'clean';
    if (isFlagged(claim_id)) {
      if (fraud) tp += 1;
      else fp += 1;
    } else if (fraud) fn += 1;
    else tn += 1;
  }
  return {
    tp,
    fp,
    fn,
    tn,
    flagged: tp + fp,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn),
    f1: ratio(2 * tp, 2 * tp + fp + fn),
  };
}

export interface SweepRow extends BinaryMetrics {
  threshold: number;
}

/** Scores of unlisted claims are 0. */
export function thresholdSweep(
  scores: ReadonlyMap<string, number>,
  labels: readonly FraudLabel[],
  thresholds: readonly number[] = SWEEP_THRESHOLDS,
): SweepRow[] {
  return thresholds.map((threshold) => ({
    threshold,
    ...binaryMetrics(labels, (id) => (scores.get(id) ?? 0) >= threshold),
  }));
}

export interface PrecisionAtK {
  k: number;
  /** min(K, number of flagged claims): unflagged claims are not part of the alert list. */
  considered: number;
  fraud: number;
  precision: number | null;
  /** Score of the last claim considered; claims tied with it may fall either side of the cut-off. */
  scoreAtCutoff: number | null;
}

export function precisionAtK(scored: readonly ScoredClaim[], fraudIds: ReadonlySet<string>, k: number): PrecisionAtK {
  const top = [...scored].sort(compareRanked).slice(0, k);
  const fraud = top.filter((c) => fraudIds.has(c.claim_id)).length;
  return { k, considered: top.length, fraud, precision: ratio(fraud, top.length), scoreAtCutoff: top.at(-1)?.risk_score ?? null };
}

export interface RuleRow {
  rule: RuleName;
  /** Claims on which the rule fired. */
  fires: number;
  /** Of those, claims labeled with any fraud type. */
  fraud: number;
  precision: number | null;
  /** Claims labeled with this rule's own pattern. */
  ownLabeled: number;
  /** Of those, claims on which this rule fired. */
  ownCaught: number;
  ownRecall: number | null;
}

export function ruleBreakdown(scored: readonly ScoredClaim[], labels: readonly FraudLabel[]): RuleRow[] {
  const typeOf = new Map<string, FraudType>(labels.map((l) => [l.claim_id, l.fraud_type]));
  return RULE_NAMES.map((rule) => {
    const fired = scored.filter((c) => c.flags.some((f) => f.rule === rule));
    const fraud = fired.filter((c) => (typeOf.get(c.claim_id) ?? 'clean') !== 'clean').length;
    const ownLabeled = labels.filter((l) => l.fraud_type === rule).length;
    const ownCaught = fired.filter((c) => typeOf.get(c.claim_id) === rule).length;
    return {
      rule,
      fires: fired.length,
      fraud,
      precision: ratio(fraud, fired.length),
      ownLabeled,
      ownCaught,
      ownRecall: ratio(ownCaught, ownLabeled),
    };
  });
}

export interface PatternRow {
  pattern: RuleName;
  labeled: number;
  /** Labeled claims with score > 0, whichever rule fired. */
  caught: number;
  recall: number | null;
}

export function patternRecall(scores: ReadonlyMap<string, number>, labels: readonly FraudLabel[]): PatternRow[] {
  return RULE_NAMES.map((pattern) => {
    const ofPattern = labels.filter((l) => l.fraud_type === pattern);
    const caught = ofPattern.filter((l) => (scores.get(l.claim_id) ?? 0) > 0).length;
    return { pattern, labeled: ofPattern.length, caught, recall: ratio(caught, ofPattern.length) };
  });
}

export interface Metrics {
  /** Generator seed of the dataset, when known. */
  seed: number | null;
  claims: number;
  fraud: number;
  clean: number;
  headline: BinaryMetrics;
  sweep: SweepRow[];
  precisionAtK: PrecisionAtK[];
  rules: RuleRow[];
  patterns: PatternRow[];
  stats: ScoreStats;
}

/** Throws if scored.json, score-stats.json and labels.csv do not describe the same claim set. */
export function computeMetrics(
  scored: readonly ScoredClaim[],
  labels: readonly FraudLabel[],
  stats: ScoreStats,
  seed: number | null = null,
): Metrics {
  const rerun = 'Run `npm run score` on the same dataset as the labels.';
  if (stats.claims !== labels.length) {
    throw new Error(`${OUTPUT_FILES.stats} reports ${stats.claims} scored claims but labels.csv has ${labels.length}. ${rerun}`);
  }
  if (stats.flagged !== scored.length) {
    throw new Error(`${OUTPUT_FILES.stats} reports ${stats.flagged} flagged claims but ${OUTPUT_FILES.scored} has ${scored.length}. ${rerun}`);
  }
  const labeled = new Set(labels.map((l) => l.claim_id));
  const scores = new Map<string, number>();
  for (const c of scored) {
    if (!labeled.has(c.claim_id)) throw new Error(`${OUTPUT_FILES.scored}: ${c.claim_id} has no label. ${rerun}`);
    if (scores.has(c.claim_id)) throw new Error(`${OUTPUT_FILES.scored}: ${c.claim_id} appears twice`);
    scores.set(c.claim_id, c.risk_score);
  }

  const fraudIds = new Set(labels.filter((l) => l.fraud_type !== 'clean').map((l) => l.claim_id));
  return {
    seed,
    claims: labels.length,
    fraud: fraudIds.size,
    clean: labels.length - fraudIds.size,
    headline: binaryMetrics(labels, (id) => (scores.get(id) ?? 0) > 0),
    sweep: thresholdSweep(scores, labels),
    precisionAtK: PRECISION_AT_K.map((k) => precisionAtK(scored, fraudIds, k)),
    rules: ruleBreakdown(scored, labels),
    patterns: patternRecall(scores, labels),
    stats,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function formatRate(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

const int = (n: number): string => formatNumber(n, 0);
const ms = (n: number): string => `${formatNumber(n, 1)} ms`;

function targetStatus(value: number | null, met: (v: number) => boolean): string {
  if (value === null) return 'n/a';
  return met(value) ? 'met' : '**not met**';
}

/** Markdown table. Columns listed in `leftAligned` (default: the first) are left-aligned, the rest right-aligned. */
function table(header: readonly string[], rows: readonly (readonly string[])[], leftAligned: readonly number[] = [0]): string {
  const line = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;
  const align = header.map((_, i) => (leftAligned.includes(i) ? ':---' : '---:'));
  return [line(header), line(align), ...rows.map(line)].join('\n');
}

export function renderMarkdown(m: Metrics, sources: { scored: string; labels: string }): string {
  const h = m.headline;
  const s = m.stats;
  const sections = [
    '# Metrics report',
    `Computed from \`${sources.scored}\` and \`${sources.labels}\`: ${int(m.claims)} claims, ` +
      `${int(m.fraud)} labeled fraud and ${int(m.clean)} clean.`,

    '## Headline: flagged = score > 0 (Decision 9)',
    table(
      ['', 'Labeled fraud', 'Labeled clean', 'Total'],
      [
        ['**Flagged**', `TP ${int(h.tp)}`, `FP ${int(h.fp)}`, int(h.flagged)],
        ['**Not flagged**', `FN ${int(h.fn)}`, `TN ${int(h.tn)}`, int(h.fn + h.tn)],
        ['**Total**', int(h.tp + h.fn), int(h.fp + h.tn), int(m.claims)],
      ],
    ),
    table(
      ['Metric', 'Value', 'Formula', 'Target'],
      [
        ['Precision', formatRate(h.precision), 'TP / (TP + FP)', ''],
        ['Recall', formatRate(h.recall), 'TP / (TP + FN)', `≥ ${formatRate(TARGETS.minRecall)}: ${targetStatus(h.recall, (v) => v >= TARGETS.minRecall)}`],
        ['FPR', formatRate(h.fpr), 'FP / (FP + TN), i.e. over clean claims only', `≤ ${formatRate(TARGETS.maxFpr)}: ${targetStatus(h.fpr, (v) => v <= TARGETS.maxFpr)}`],
        ['F1', formatRate(h.f1), '2TP / (2TP + FP + FN)', ''],
      ],
      [0, 2, 3],
    ),

    '## Threshold sweep: flagged = score ≥ t',
    table(
      ['t', 'Flagged', 'TP', 'FP', 'FN', 'TN', 'Precision', 'Recall', 'FPR', 'F1'],
      m.sweep.map((r) => [
        String(r.threshold),
        int(r.flagged),
        int(r.tp),
        int(r.fp),
        int(r.fn),
        int(r.tn),
        formatRate(r.precision),
        formatRate(r.recall),
        formatRate(r.fpr),
        formatRate(r.f1),
      ]),
    ),

    '## Precision@K',
    'Top K flagged claims in rank order (score descending, then claim_id ascending). ' +
      'If fewer than K claims are flagged, all flagged claims are used. ' +
      'Claims tied with the score at the cut-off may fall on either side of it.',
    table(
      ['K', 'Claims considered', 'Fraud', 'Precision@K', 'Score at cut-off'],
      m.precisionAtK.map((p) => [
        String(p.k),
        int(p.considered),
        int(p.fraud),
        formatRate(p.precision),
        p.scoreAtCutoff === null ? 'n/a' : String(p.scoreAtCutoff),
      ]),
    ),

    '## Per rule',
    '"Fraud" counts fired claims labeled with any fraud type. ' +
      '"Own-pattern recall" is the share of claims labeled with the rule’s own pattern on which that rule fired.',
    table(
      ['Rule', 'Fires', 'Fraud', 'Rule precision', 'Own pattern caught', 'Own-pattern recall'],
      m.rules.map((r) => [
        r.rule,
        int(r.fires),
        int(r.fraud),
        formatRate(r.precision),
        `${int(r.ownCaught)} / ${int(r.ownLabeled)}`,
        formatRate(r.ownRecall),
      ]),
    ),

    '## Engine recall by fraud pattern',
    'A labeled claim counts as caught when its score is > 0, whichever rule fired.',
    table(
      ['Pattern', 'Labeled', 'Caught', 'Recall'],
      m.patterns.map((p) => [p.pattern, int(p.labeled), int(p.caught), formatRate(p.recall)]),
    ),

    '## Upcoding coverage',
    `- Not evaluated because the procedure-code group has fewer than ${int(s.upcoding_skipped.min_other_claims)} other claims ` +
      `(Decision 15): **${int(s.upcoding_skipped.insufficient_data)}** claims.\n` +
      `- Not evaluated because the other claims in the group all have the same amount (SD = 0): ${int(s.upcoding_skipped.zero_sd)} claims.`,

    '## Performance',
    `- Rules, scoring and ranking for ${int(s.claims)} claims: **${ms(s.scoring_ms)}**.\n` +
      `- Including reading config and claims and writing \`${OUTPUT_FILES.scored}\` and \`${OUTPUT_FILES.ranked}\`: ${ms(s.total_ms)}.\n` +
      '- Brief limit: 30 s for 2,000 claims.',
  ];
  return `${sections.join('\n\n')}\n`;
}

/** The 5-line console summary printed at the end of `npm run report` (and so of `npm run all`). */
export function summaryLines(m: Metrics): string[] {
  const h = m.headline;
  return [
    `Claims:     ${int(m.claims)} (${int(m.fraud)} labeled fraud, ${int(m.clean)} clean)${m.seed === null ? '' : `, seed ${m.seed}`}`,
    `Flagged:    ${int(h.flagged)} (score > 0)`,
    `Precision:  ${formatRate(h.precision)}   Recall: ${formatRate(h.recall)} (target ≥ ${formatRate(TARGETS.minRecall)})`,
    `FPR:        ${formatRate(h.fpr)} = FP / clean claims (target ≤ ${formatRate(TARGETS.maxFpr)})`,
    `Time:       ${ms(m.stats.scoring_ms)} to score ${int(m.stats.claims)} claims (${ms(m.stats.total_ms)} with file I/O)`,
  ];
}

// ---------------------------------------------------------------------------
// Seed comparison
// ---------------------------------------------------------------------------

/** Percentage points beyond which two runs are considered to disagree. */
export const GAP_THRESHOLD_PP = 5;
export const COMPARISON_START = '<!-- seed-comparison:start -->';
export const COMPARISON_END = '<!-- seed-comparison:end -->';

/** The numbers of one run needed to compare it with another. Holds no labels. */
export interface RunSummary {
  seed: number | null;
  config_hash: string;
  claims: number;
  fraud: number;
  flagged: number;
  precision: number | null;
  recall: number | null;
  fpr: number | null;
  f1: number | null;
  precision_at_100: number | null;
}

export function summarize(m: Metrics, configHash: string): RunSummary {
  return {
    seed: m.seed,
    config_hash: configHash,
    claims: m.claims,
    fraud: m.fraud,
    flagged: m.headline.flagged,
    precision: m.headline.precision,
    recall: m.headline.recall,
    fpr: m.headline.fpr,
    f1: m.headline.f1,
    precision_at_100: m.precisionAtK.find((p) => p.k === 100)?.precision ?? null,
  };
}

export function summaryFromJson(text: string): RunSummary {
  const data: unknown = JSON.parse(text);
  const where = OUTPUT_FILES.summary;
  if (!isRecord(data)) throw new Error(`${where}: must be an object`);
  const num = (key: string): number => {
    const v = data[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${where}: ${key} must be a number`);
    return v;
  };
  const rate = (key: string): number | null => (data[key] === null ? null : num(key));
  const { seed, config_hash } = data;
  if (seed !== null && (typeof seed !== 'number' || !Number.isFinite(seed))) throw new Error(`${where}: seed must be a number or null`);
  if (typeof config_hash !== 'string') throw new Error(`${where}: config_hash must be a string`);
  return {
    seed,
    config_hash,
    claims: num('claims'),
    fraud: num('fraud'),
    flagged: num('flagged'),
    precision: rate('precision'),
    recall: rate('recall'),
    fpr: rate('fpr'),
    f1: rate('f1'),
    precision_at_100: rate('precision_at_100'),
  };
}

/** b − a in percentage points, or null if either is missing. */
export function gapPp(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : (b - a) * 100;
}

const runName = (r: RunSummary): string => (r.seed === null ? 'run' : `seed ${r.seed}`);

/** Block placed under the title of metrics.md, comparing two runs; `first` is the left column. */
export function renderComparison(first: RunSummary, second: RunSummary): string {
  const metrics: [string, (r: RunSummary) => number | null][] = [
    ['Precision', (r) => r.precision],
    ['Recall', (r) => r.recall],
    ['FPR', (r) => r.fpr],
    ['F1', (r) => r.f1],
    ['Precision@100', (r) => r.precision_at_100],
  ];
  const wide: string[] = [];
  const rows = metrics.map(([name, get]) => {
    const gap = gapPp(get(first), get(second));
    const exceeds = gap !== null && Math.abs(gap) > GAP_THRESHOLD_PP;
    if (exceeds) wide.push(name);
    const text = gap === null ? 'n/a' : `${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(1)} pp${exceeds ? ` (> ${GAP_THRESHOLD_PP} pp)` : ''}`;
    return [name, formatRate(get(first)), formatRate(get(second)), exceeds ? `**${text}**` : text];
  });
  const lines = [
    `## ${runName(first)} vs ${runName(second)}`,
    `Each run is a separate dataset scored with the same code and config, with no tuning in between. Flagged = score > 0. ` +
      `Difference = ${runName(second)} − ${runName(first)}.`,
    table(['Metric', runName(first), runName(second), 'Difference'], [
      ...rows,
      ['Flagged claims', int(first.flagged), int(second.flagged), ''],
    ]),
  ];
  if (first.config_hash !== second.config_hash) {
    lines.push(`**Warning:** the config differs between the two runs (${first.config_hash} vs ${second.config_hash}), so this is not a clean holdout.`);
  }
  lines.push(
    wide.length > 0
      ? `Gaps above ${GAP_THRESHOLD_PP} pp: ${wide.join(', ')}.`
      : `No metric differs by more than ${GAP_THRESHOLD_PP} pp.`,
  );
  return lines.join('\n\n');
}

/** Puts `section` between the comparison markers, replacing an earlier one or inserting it under the title. */
export function upsertComparison(markdown: string, section: string): string {
  const block = `${COMPARISON_START}\n${section}\n${COMPARISON_END}`;
  const start = markdown.indexOf(COMPARISON_START);
  const end = markdown.indexOf(COMPARISON_END);
  if (start !== -1 && end > start) return markdown.slice(0, start) + block + markdown.slice(end + COMPARISON_END.length);
  const newline = markdown.indexOf('\n');
  if (newline === -1) return `${markdown}\n\n${block}\n`;
  return `${markdown.slice(0, newline)}\n\n${block}${markdown.slice(newline)}`;
}

export interface ReportOptions {
  labelsPath: string;
  outDir: string;
  seed: number | null;
  /** Results directory of another run to compare with; skipped if it has no run-summary.json yet. */
  compareDir: string | null;
  /** Whether this run is the left column of the comparison (the baseline). */
  thisRunFirst: boolean;
}

/** Reads scored.json and labels, writes metrics.md and run-summary.json, and syncs the comparison into both runs' metrics.md. */
export function runReport(options: ReportOptions): Metrics {
  const { labelsPath, outDir, seed, compareDir, thisRunFirst } = options;
  const scoredPath = join(outDir, OUTPUT_FILES.scored);
  const metricsPath = join(outDir, OUTPUT_FILES.metrics);

  const metrics = computeMetrics(
    scoredFromJson(readFileSync(scoredPath, 'utf8')),
    labelsFromCsv(readFileSync(labelsPath, 'utf8')),
    statsFromJson(readFileSync(join(outDir, OUTPUT_FILES.stats), 'utf8')),
    seed,
  );
  const summary = summarize(metrics, configFingerprint());
  writeFileSync(metricsPath, renderMarkdown(metrics, { scored: scoredPath, labels: labelsPath }), 'utf8');
  writeFileSync(join(outDir, OUTPUT_FILES.summary), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${metricsPath}`);

  const otherSummaryPath = compareDir === null ? null : join(compareDir, OUTPUT_FILES.summary);
  if (compareDir !== null && otherSummaryPath !== null && existsSync(otherSummaryPath)) {
    const other = summaryFromJson(readFileSync(otherSummaryPath, 'utf8'));
    const section = thisRunFirst ? renderComparison(summary, other) : renderComparison(other, summary);
    for (const path of [metricsPath, join(compareDir, OUTPUT_FILES.metrics)]) {
      if (existsSync(path)) writeFileSync(path, upsertComparison(readFileSync(path, 'utf8'), section), 'utf8');
    }
    console.log(`Added the ${runName(summary)} vs ${runName(other)} comparison to ${metricsPath} and ${join(compareDir, OUTPUT_FILES.metrics)}`);
  }

  console.log(`\n${summaryLines(metrics).join('\n')}`);
  return metrics;
}

if (isEntryPoint(import.meta.url)) {
  const usage = 'Usage: report [--labels PATH] [--out DIR] [--seed N] [--compare DIR]';
  const args = parseFlags(process.argv.slice(2), { labels: 'data/labels.csv', out: 'output', seed: '', compare: '' }, usage);
  const seed = args.seed === '' ? null : Number(args.seed);
  if (seed !== null && !Number.isInteger(seed)) throw new Error(`--seed must be an integer, got "${args.seed}". ${usage}`);
  runReport({ labelsPath: args.labels, outDir: args.out, seed, compareDir: args.compare === '' ? null : args.compare, thisRunFirst: true });
}
