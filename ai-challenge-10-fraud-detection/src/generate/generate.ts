import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSurgical } from '../codes.js';
import { claimsToCsv, formatCsv } from '../csv.js';
import type { Config, FraudLabel } from '../types.js';
import { generateClean } from './clean.js';
import type { GenContext } from './context.js';
import { finalize, type Dataset } from './finalize.js';
import {
  cleanComboStats,
  clusteringBases,
  injectClustering,
  injectDuplicates,
  injectMismatch,
  injectPhantom,
  injectRapid,
  injectUnbundling,
  injectUpcoding,
  injectWeekend,
  type PhantomInfo,
} from './inject.js';
import { Ledger } from './ledger.js';
import { PARAMS } from './params.js';
import { buildProviders, isHospital, type Provider, type ProviderGroup } from './providers.js';
import { Rng } from './rng.js';
import { verifyDataset } from './verify.js';

export interface GenerationStats {
  seed: number;
  counts: Record<FraudLabel['fraud_type'], number>;
  members: number;
  providers: number;
  surgicalByHospital: { providerId: string; group: ProviderGroup; clean: number; injected: number }[];
  clusteringBases: { combo: string; cleanClaims: number; mean: number; sd: number; meanPlus2Sd: number }[];
  phantom: PhantomInfo & { claimsOnDay: number; knownFalsePositives: number };
}

export interface GeneratedDataset extends Dataset {
  stats: GenerationStats;
}

/** Pure: same config + seed always gives the same dataset. */
export function generateDataset(config: Config, seed: number): GeneratedDataset {
  const rng = new Rng(seed);
  const providers = buildProviders(rng);
  const members = Array.from({ length: PARAMS.memberCount }, (_, i) => `M-${String(i + 1).padStart(4, '0')}`);
  const ctx: GenContext = { rng, config, ledger: new Ledger(config), providers, members };

  generateClean(ctx);
  const comboStats = cleanComboStats(ctx);
  const bases = clusteringBases(comboStats);

  // Injection order: see DATA_DESIGN.md §F.
  const phantom = injectPhantom(ctx);
  injectWeekend(ctx);
  injectDuplicates(ctx);
  injectRapid(ctx);
  injectUnbundling(ctx);
  injectMismatch(ctx);
  injectUpcoding(ctx, comboStats);
  injectClustering(ctx, bases);

  const dataset = finalize(ctx);
  verifyDataset(dataset, providers, config, phantom);

  return {
    ...dataset,
    stats: summarize(dataset, providers, config, seed, phantom, bases),
  };
}

function summarize(
  { claims, labels }: Dataset,
  providers: readonly Provider[],
  config: Config,
  seed: number,
  phantom: PhantomInfo,
  bases: ReturnType<typeof clusteringBases>,
): GenerationStats {
  const typeOf = new Map(labels.map((l) => [l.claim_id, l.fraud_type]));
  const counts = {} as GenerationStats['counts'];
  for (const l of labels) counts[l.fraud_type] = (counts[l.fraud_type] ?? 0) + 1;

  const surgicalByHospital = providers.filter(isHospital).map((p) => {
    const surgical = claims.filter((c) => c.provider_id === p.id && isSurgical(c.procedure_codes, config));
    const clean = surgical.filter((c) => typeOf.get(c.claim_id) === 'clean').length;
    return { providerId: p.id, group: p.group, clean, injected: surgical.length - clean };
  });
  const groupOrder: ProviderGroup[] = ['scheduled_heavy', 'scheduled_light', 'hospital_24_7'];
  surgicalByHospital.sort((a, b) => groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || (a.providerId < b.providerId ? -1 : 1));

  const onDay = claims.filter((c) => c.provider_id === phantom.providerId && c.claim_date === phantom.date);
  return {
    seed,
    counts,
    members: new Set(claims.map((c) => c.member_id)).size,
    providers: new Set(claims.map((c) => c.provider_id)).size,
    surgicalByHospital,
    clusteringBases: bases.map((b) => ({ combo: b.key, cleanClaims: b.count, mean: b.mean, sd: b.sd, meanPlus2Sd: b.mean + 2 * b.sd })),
    phantom: {
      ...phantom,
      claimsOnDay: onDay.length,
      knownFalsePositives: onDay.filter((c) => typeOf.get(c.claim_id) === 'clean').length,
    },
  };
}

export function labelsToCsv(labels: readonly FraudLabel[]): string {
  return formatCsv([['claim_id', 'fraud_type'], ...labels.map((l) => [l.claim_id, l.fraud_type])]);
}

export function writeDataset(outDir: string, dataset: Dataset): { claimsPath: string; labelsPath: string } {
  mkdirSync(outDir, { recursive: true });
  const claimsPath = join(outDir, 'claims.csv');
  const labelsPath = join(outDir, 'labels.csv');
  writeFileSync(claimsPath, claimsToCsv(dataset.claims), 'utf8');
  writeFileSync(labelsPath, labelsToCsv(dataset.labels), 'utf8');
  return { claimsPath, labelsPath };
}
