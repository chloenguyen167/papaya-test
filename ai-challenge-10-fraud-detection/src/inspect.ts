/**
 * `npm run inspect`: shows how fraudulent claims differ from clean ones in ways no
 * rule uses, and which kinds of natural noise the clean data lacks (Decision 21).
 * Diagnostic only: it reads labels.csv, and nothing here feeds the rules or the score.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEntryPoint, parseFlags } from './cli.js';
import { comboKey } from './codes.js';
import { loadConfig } from './config.js';
import { compareClaimIds, memberDiagnosisKey } from './context.js';
import { readClaims } from './csv.js';
import { diffDays, isWeekend } from './dates.js';
import { formatNumber } from './format.js';
import { formatRate, labelsFromCsv, ratio } from './metrics.js';
import { RULE_NAMES, type Claim, type Config, type FraudLabel } from './types.js';

export const TELLS_TITLE = 'Known tells of the synthetic data (not used by any rule)';

type FraudType = FraudLabel['fraud_type'];

export interface GroupTells {
  group: FraudType | 'all fraud';
  claims: number;
  /** Mean 1-based position of the group's claim_ids in claim_id order. */
  meanIdRank: number | null;
  divisibleBy100: number | null;
  weekend: number | null;
  inpatient: number | null;
  /** Claims whose (diagnosis, procedure combination) never occurs on a clean claim; null for the clean group. */
  unseenDxCombo: number | null;
}

export interface DatasetTells {
  claims: number;
  /** Mean rank if claim_id order carried no information: (n + 1) / 2. */
  expectedMeanRank: number;
  /** clean, all fraud, then one row per fraud type in RULE_NAMES order. */
  groups: GroupTells[];
  clusteringBand: { min: number; max: number };
  cleanInClusteringBand: number;
  rapidGap: { min: number; max: number };
  /** Consecutive clean claims of the same member + diagnosis whose gap falls in the rapid re-submission window. */
  cleanRapidPairs: number;
}

const dxComboKey = (c: Claim): string => `${c.diagnosis_code}|${comboKey(c.procedure_codes)}`;

export function inspectDataset(claims: readonly Claim[], labels: readonly FraudLabel[], config: Config): DatasetTells {
  const typeOf = new Map(labels.map((l) => [l.claim_id, l.fraud_type]));
  if (typeOf.size !== claims.length) {
    throw new Error(`labels cover ${typeOf.size} claims but claims.csv has ${claims.length}`);
  }
  const fraudType = (c: Claim): FraudType => {
    const type = typeOf.get(c.claim_id);
    if (type === undefined) throw new Error(`claim ${c.claim_id} has no label`);
    return type;
  };

  const rank = new Map(
    [...claims].sort((a, b) => compareClaimIds(a.claim_id, b.claim_id)).map((c, i) => [c.claim_id, i + 1]),
  );
  const clean = claims.filter((c) => fraudType(c) === 'clean');
  const cleanDxCombos = new Set(clean.map(dxComboKey));

  const share = (group: readonly Claim[], test: (c: Claim) => boolean): number | null =>
    ratio(group.filter(test).length, group.length);
  const tells = (group: FraudType | 'all fraud', members: readonly Claim[]): GroupTells => ({
    group,
    claims: members.length,
    meanIdRank: ratio(members.reduce((sum, c) => sum + (rank.get(c.claim_id) ?? 0), 0), members.length),
    divisibleBy100: share(members, (c) => c.submitted_amount % 100 === 0),
    weekend: share(members, (c) => isWeekend(c.claim_date)),
    inpatient: share(members, (c) => c.claim_type === 'INPATIENT'),
    unseenDxCombo: group === 'clean' ? null : members.filter((c) => !cleanDxCombos.has(dxComboKey(c))).length,
  });

  const { min_amount, max_amount } = config.thresholds.amount_clustering;
  const { min_gap_days, max_gap_days } = config.thresholds.rapid_resubmission;

  const history = new Map<string, Claim[]>();
  for (const c of clean) {
    const key = memberDiagnosisKey(c);
    const list = history.get(key);
    if (list) list.push(c);
    else history.set(key, [c]);
  }
  let cleanRapidPairs = 0;
  for (const list of history.values()) {
    list.sort((a, b) => a.claim_date.localeCompare(b.claim_date));
    for (let i = 1; i < list.length; i++) {
      const gap = diffDays((list[i - 1] as Claim).claim_date, (list[i] as Claim).claim_date);
      if (gap >= min_gap_days && gap <= max_gap_days) cleanRapidPairs += 1;
    }
  }

  return {
    claims: claims.length,
    expectedMeanRank: (claims.length + 1) / 2,
    groups: [
      tells('clean', clean),
      tells('all fraud', claims.filter((c) => fraudType(c) !== 'clean')),
      ...RULE_NAMES.map((type) => tells(type, claims.filter((c) => fraudType(c) === type))),
    ],
    clusteringBand: { min: min_amount, max: max_amount },
    cleanInClusteringBand: clean.filter((c) => c.submitted_amount >= min_amount && c.submitted_amount <= max_amount).length,
    rapidGap: { min: min_gap_days, max: max_gap_days },
    cleanRapidPairs,
  };
}

export function renderTells(t: DatasetTells): string {
  const int = (n: number): string => formatNumber(n, 0);
  const header = ['Group', 'Claims', 'Mean ID rank', 'Amount % 100 = 0', 'Weekend', 'Inpatient', 'Unseen (dx, procedures)'];
  const rows = t.groups.map((g) => [
    g.group,
    int(g.claims),
    g.meanIdRank === null ? 'n/a' : formatNumber(g.meanIdRank, 0),
    formatRate(g.divisibleBy100),
    formatRate(g.weekend),
    formatRate(g.inpatient),
    g.unseenDxCombo === null ? '-' : `${int(g.unseenDxCombo)} / ${int(g.claims)}`,
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i] ?? 0) : cell.padStart(widths[i] ?? 0))).join('  ');

  return [
    TELLS_TITLE,
    '='.repeat(TELLS_TITLE.length),
    `${int(t.claims)} claims. Mean ID rank if claim_id order carried no information: ${formatNumber(t.expectedMeanRank, 1)}.`,
    '"Unseen (dx, procedures)": claims whose diagnosis + procedure combination never occurs on a clean claim.',
    '',
    line(header),
    ...rows.map(line),
    '',
    'Natural noise missing from the clean data (Decisions 12, 18, 21):',
    `  Clean claims with amount in ${int(t.clusteringBand.min)}–${int(t.clusteringBand.max)}: ${int(t.cleanInClusteringBand)}`,
    `  Clean claim pairs, same member + diagnosis, ${t.rapidGap.min}–${t.rapidGap.max} days apart: ${int(t.cleanRapidPairs)}`,
  ].join('\n');
}

/** Reads `dataDir`/claims.csv and `dataDir`/labels.csv and returns the printed report. */
export function runInspect(dataDir: string, configDir = 'config'): string {
  const claims = readClaims(join(dataDir, 'claims.csv'));
  const labels = labelsFromCsv(readFileSync(join(dataDir, 'labels.csv'), 'utf8'));
  return renderTells(inspectDataset(claims, labels, loadConfig(configDir)));
}

if (isEntryPoint(import.meta.url)) {
  const args = parseFlags(process.argv.slice(2), { data: 'data' }, 'Usage: inspect [--data DIR]');
  console.log(runInspect(args.data));
}
