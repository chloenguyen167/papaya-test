import { loadConfig } from '../config.js';
import { generateDataset, writeDataset, type GenerationStats } from './generate.js';

interface CliArgs {
  seed: number;
  out: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { seed: 42, out: 'data' };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = (argv[i] ?? '').split('=', 2);
    const value = (): string => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '') throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === '--seed') {
      const raw = value();
      const seed = Number(raw);
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error(`--seed must be an integer in [0, 2^32), got "${raw}"`);
      args.seed = seed;
    } else if (flag === '--out') {
      args.out = value();
    } else {
      throw new Error(`Unknown argument "${argv[i]}". Usage: generate [--seed N] [--out DIR]`);
    }
  }
  return args;
}

function printStats(s: GenerationStats, paths: { claimsPath: string; labelsPath: string }): void {
  const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');
  console.log(`Seed ${s.seed}: wrote ${paths.claimsPath} and ${paths.labelsPath}`);
  console.log(`Members: ${s.members}, providers: ${s.providers}\n`);

  console.log('Claims by fraud_type');
  for (const [type, n] of Object.entries(s.counts).sort((a, b) => b[1] - a[1])) console.log(`  ${type.padEnd(22)} ${String(n).padStart(5)}`);
  const total = Object.values(s.counts).reduce((a, b) => a + b, 0);
  console.log(`  ${'total'.padEnd(22)} ${String(total).padStart(5)}\n`);

  console.log('Surgical claims per hospital (clean + injected)');
  for (const h of s.surgicalByHospital) {
    console.log(`  ${h.providerId}  ${h.group.padEnd(16)} ${String(h.clean).padStart(3)} + ${String(h.injected).padStart(2)}`);
  }

  console.log('\nClustering base combinations (Decision 16: mean + 2 SD >= 50,500)');
  for (const b of s.clusteringBases) {
    console.log(`  ${b.combo.padEnd(24)} n=${String(b.cleanClaims).padStart(3)}  mean=${fmt(b.mean)}  sd=${fmt(b.sd)}  mean+2sd=${fmt(b.meanPlus2Sd)}`);
  }

  const p = s.phantom;
  console.log(`\nPhantom day: ${p.providerId} on ${p.date}, ${p.claimsOnDay} claims, ${p.knownFalsePositives} known false positives (clean claims on that day)`);
}

const args = parseArgs(process.argv.slice(2));
const dataset = generateDataset(loadConfig(), args.seed);
printStats(dataset.stats, writeDataset(args.out, dataset));
