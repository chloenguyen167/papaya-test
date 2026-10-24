import { isAbsolute, join, relative } from 'node:path';
import { isEntryPoint, parseFlags } from './cli.js';
import { loadConfig } from './config.js';
import { generateDataset, writeDataset } from './generate/generate.js';
import { runReport } from './metrics.js';
import { runScore } from './score.js';

export const DEFAULT_SEED = 42;
export const DEFAULT_DATA_DIR = 'data';
export const BASELINE_RESULTS_DIR = 'output';

/** Where results go for a dataset directory: data → output, data/holdout → output/holdout. */
export function resultsDirFor(dataDir: string): string {
  const rel = relative(DEFAULT_DATA_DIR, dataDir);
  if (rel === '') return BASELINE_RESULTS_DIR;
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`--out must be "${DEFAULT_DATA_DIR}" or a directory inside it, got "${dataDir}"`);
  }
  return join(BASELINE_RESULTS_DIR, rel);
}

/** The run each report is compared with: the baseline is compared with output/holdout, any other run with the baseline. */
export function compareDirFor(resultsDir: string): string {
  return resultsDir === BASELINE_RESULTS_DIR ? join(BASELINE_RESULTS_DIR, 'holdout') : BASELINE_RESULTS_DIR;
}

export function parseSeed(raw: string): number {
  const seed = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error(`--seed must be an integer in [0, 2^32), got "${raw}"`);
  }
  return seed;
}

/** generate → score → report for one seed, with data in `dataDir` and results in the matching output directory. */
export function runPipeline(seed: number, dataDir: string): void {
  const resultsDir = resultsDirFor(dataDir);
  const config = loadConfig();

  const dataset = generateDataset(config, seed);
  const { claimsPath, labelsPath } = writeDataset(dataDir, dataset);
  console.log(`Seed ${seed}: wrote ${claimsPath} and ${labelsPath}\n`);

  runScore(claimsPath, resultsDir, config);
  console.log();
  runReport({
    labelsPath,
    outDir: resultsDir,
    seed,
    compareDir: compareDirFor(resultsDir),
    thisRunFirst: resultsDir === BASELINE_RESULTS_DIR,
  });
}

if (isEntryPoint(import.meta.url)) {
  const args = parseFlags(
    process.argv.slice(2),
    { seed: String(DEFAULT_SEED), out: DEFAULT_DATA_DIR },
    'Usage: all [--seed N] [--out DIR]   (DIR is "data" or inside it, e.g. --seed 7 --out data/holdout)',
  );
  runPipeline(parseSeed(args.seed), args.out);
}
