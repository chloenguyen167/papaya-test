import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEntryPoint, parseFlags } from './cli.js';
import { loadConfig } from './config.js';
import { buildContext, compareClaimIds } from './context.js';
import { formatCsv, readClaims } from './csv.js';
import { runRules, type ClaimFlags } from './engine.js';
import { formatNumber } from './format.js';
import { countUpcodingSkips } from './rules/upcoding.js';
import type { Config, Priority, ScoredClaim, ScoringConfig } from './types.js';

export const OUTPUT_FILES = {
  scored: 'scored.json',
  ranked: 'ranked.csv',
  stats: 'score-stats.json',
  metrics: 'metrics.md',
  summary: 'run-summary.json',
} as const;

export const RANKED_COLUMNS = ['claim_id', 'risk_score', 'priority', 'rules'] as const;
export const RULE_SEPARATOR = '|';

export interface RankedClaim extends ScoredClaim {
  priority: Priority;
}

/** What `npm run score` measured, read by the report. Holds no labels. */
export interface ScoreStats {
  claims: number;
  flagged: number;
  /** Building the context, running the 8 rules, scoring and ranking every claim, in ms. */
  scoring_ms: number;
  /** Reading config and claims through writing scored.json and ranked.csv, in ms. */
  total_ms: number;
  upcoding_skipped: { min_other_claims: number; insufficient_data: number; zero_sd: number };
}

/**
 * risk_score = round(100 × (1 − e^(−raw / saturation))) (Decision 20). A claim with
 * at least one flag never rounds down to 0, so "score > 0" always means "a rule fired"
 * (Decision 9) whatever the saturation.
 */
export function riskScore(raw: number, saturation: number): number {
  if (raw <= 0) return 0;
  return Math.max(1, Math.round(100 * (1 - Math.exp(-raw / saturation))));
}

export function priorityOf(score: number, scoring: ScoringConfig): Priority {
  if (score >= scoring.high_priority_min) return 'High';
  if (score >= scoring.medium_priority_min) return 'Medium';
  return score > 0 ? 'Low' : 'None';
}

/** Rank order: risk_score descending, then claim_id ascending. */
export function compareRanked(a: ScoredClaim, b: ScoredClaim): number {
  return b.risk_score - a.risk_score || compareClaimIds(a.claim_id, b.claim_id);
}

/** Scores every claim from the severities of its flags and returns them all in rank order. */
export function scoreClaims(results: readonly ClaimFlags[], scoring: ScoringConfig): RankedClaim[] {
  return results
    .map(({ claim_id, flags }) => {
      const raw = flags.reduce((sum, flag) => sum + flag.severity, 0);
      const risk_score = riskScore(raw, scoring.saturation);
      return { claim_id, risk_score, priority: priorityOf(risk_score, scoring), flags };
    })
    .sort(compareRanked);
}

/** Contents of scored.json: flagged claims only, in rank order, in the brief's per-claim shape. */
export function toScoredJson(ranked: readonly RankedClaim[]): ScoredClaim[] {
  return ranked.filter((c) => c.risk_score > 0).map(({ claim_id, risk_score, flags }) => ({ claim_id, risk_score, flags }));
}

/** Contents of ranked.csv: every claim, in rank order. */
export function rankedToCsv(ranked: readonly RankedClaim[]): string {
  return formatCsv([
    [...RANKED_COLUMNS],
    ...ranked.map((c) => [c.claim_id, String(c.risk_score), c.priority, c.flags.map((f) => f.rule).join(RULE_SEPARATOR)]),
  ]);
}

const roundMs = (ms: number): number => Math.round(ms * 10) / 10;

/** Scores the claims in `claimsPath` and writes scored.json, ranked.csv and score-stats.json into `outDir`. */
export function runScore(claimsPath: string, outDir: string, config: Config = loadConfig()): ScoreStats {
  const start = performance.now();
  const claims = readClaims(claimsPath);
  const scoringStart = performance.now();
  const ranked = scoreClaims(runRules(claims, config), config.scoring);
  const scoringMs = performance.now() - scoringStart;

  const scored = toScoredJson(ranked);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, OUTPUT_FILES.scored), `${JSON.stringify(scored, null, 2)}\n`, 'utf8');
  writeFileSync(join(outDir, OUTPUT_FILES.ranked), rankedToCsv(ranked), 'utf8');
  const totalMs = performance.now() - start;

  const skips = countUpcodingSkips(buildContext(claims, config));
  const stats: ScoreStats = {
    claims: claims.length,
    flagged: scored.length,
    scoring_ms: roundMs(scoringMs),
    total_ms: roundMs(totalMs),
    upcoding_skipped: {
      min_other_claims: config.thresholds.upcoding.min_other_claims,
      insufficient_data: skips.insufficientData,
      zero_sd: skips.zeroSd,
    },
  };
  writeFileSync(join(outDir, OUTPUT_FILES.stats), `${JSON.stringify(stats, null, 2)}\n`, 'utf8');

  const byPriority = (p: Priority): number => ranked.filter((c) => c.priority === p).length;
  console.log(
    `Scored ${formatNumber(claims.length)} claims in ${formatNumber(stats.scoring_ms, 1)} ms: ${scored.length} flagged ` +
      `(High ${byPriority('High')}, Medium ${byPriority('Medium')}, Low ${byPriority('Low')})`,
  );
  console.log(`Wrote ${join(outDir, OUTPUT_FILES.scored)}, ${join(outDir, OUTPUT_FILES.ranked)}, ${join(outDir, OUTPUT_FILES.stats)}`);
  return stats;
}

if (isEntryPoint(import.meta.url)) {
  const args = parseFlags(process.argv.slice(2), { claims: 'data/claims.csv', out: 'output' }, 'Usage: score [--claims PATH] [--out DIR]');
  runScore(args.claims, args.out);
}
