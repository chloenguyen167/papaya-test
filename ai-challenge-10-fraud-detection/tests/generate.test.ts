import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { isSurgical } from '../src/codes.js';
import { loadConfig } from '../src/config.js';
import { parseCsv } from '../src/csv.js';
import { dayNumber, isValidIsoDate, isWeekend } from '../src/dates.js';
import { generateDataset, writeDataset, type GeneratedDataset } from '../src/generate/generate.js';
import { buildProviders } from '../src/generate/providers.js';
import { Rng } from '../src/generate/rng.js';
import type { Claim, Config } from '../src/types.js';

const root = join(import.meta.dirname, '..');
const BRIEF_COLUMNS = [
  'claim_id', 'member_id', 'provider_id', 'provider_name', 'claim_date',
  'claim_type', 'diagnosis_code', 'procedure_codes', 'submitted_amount', 'is_weekend',
];

let config: Config;
let data: GeneratedDataset;
let typeOf: Map<string, string>;
let clean: Claim[];

beforeAll(() => {
  config = loadConfig(join(root, 'config'));
  data = generateDataset(config, 42);
  typeOf = new Map(data.labels.map((l) => [l.claim_id, l.fraud_type]));
  clean = data.claims.filter((c) => typeOf.get(c.claim_id) === 'clean');
});

describe('generator', () => {
  it('writes byte-identical files for the same seed, different files for another seed', () => {
    const [a, b, c] = [1, 2, 3].map(() => mkdtempSync(join(tmpdir(), 'claims-')));
    writeDataset(a as string, generateDataset(config, 42));
    writeDataset(b as string, generateDataset(config, 42));
    writeDataset(c as string, generateDataset(config, 7));
    for (const file of ['claims.csv', 'labels.csv']) {
      const fa = readFileSync(join(a as string, file));
      expect(fa.equals(readFileSync(join(b as string, file)))).toBe(true);
      expect(fa.equals(readFileSync(join(c as string, file)))).toBe(false);
    }
  });

  it('produces 1,800 clean claims and exactly the brief count of each fraud pattern', () => {
    const counts: Record<string, number> = {};
    for (const l of data.labels) counts[l.fraud_type] = (counts[l.fraud_type] ?? 0) + 1;
    expect(data.claims).toHaveLength(2000);
    expect(counts).toEqual({
      clean: 1800,
      duplicate_claim: 30,
      rapid_resubmission: 30,
      upcoding: 30,
      unbundling: 25,
      phantom_billing: 25,
      weekend_anomaly: 20,
      dx_procedure_mismatch: 20,
      amount_clustering: 20,
    });
  });

  it('writes claims.csv with exactly the brief columns and labels.csv with claim_id,fraud_type', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claims-'));
    const { claimsPath, labelsPath } = writeDataset(dir, data);
    expect(parseCsv(readFileSync(claimsPath, 'utf8'))[0]).toEqual(BRIEF_COLUMNS);
    expect(parseCsv(readFileSync(labelsPath, 'utf8'))[0]).toEqual(['claim_id', 'fraud_type']);
  });

  it('puts every claim date in 2024 with a matching is_weekend', () => {
    for (const c of data.claims) {
      expect(isValidIsoDate(c.claim_date)).toBe(true);
      expect(c.claim_date.slice(0, 4)).toBe('2024');
      expect(c.is_weekend).toBe(isWeekend(c.claim_date));
    }
  });

  it('has no clean claim in the 47,500–49,999 clustering band', () => {
    const inBand = clean.filter((c) => c.submitted_amount >= 47_500 && c.submitted_amount <= 49_999);
    expect(inBand).toEqual([]);
  });

  it('keeps clean claims of the same member + diagnosis at least 8 days apart', () => {
    const days = new Map<string, number[]>();
    for (const c of clean) {
      const key = `${c.member_id}|${c.diagnosis_code}`;
      days.set(key, [...(days.get(key) ?? []), dayNumber(c.claim_date)]);
    }
    for (const list of days.values()) {
      list.sort((x, y) => x - y);
      for (let i = 1; i < list.length; i++) expect((list[i] ?? 0) - (list[i - 1] ?? 0)).toBeGreaterThanOrEqual(8);
    }
  });

  it('gives the 12 heavy scheduled-surgery hospitals 30 clean surgical claims and no clean weekend claim', () => {
    // Providers depend only on the seed's first draws, so rebuilding them gives the same groups.
    const providers = buildProviders(new Rng(42));
    const heavy = providers.filter((p) => p.group === 'scheduled_heavy');
    const scheduled = providers.filter((p) => p.group === 'scheduled_heavy' || p.group === 'scheduled_light');
    expect(heavy).toHaveLength(12);
    expect(scheduled).toHaveLength(15);
    for (const p of scheduled) {
      expect(clean.filter((c) => c.provider_id === p.id && c.is_weekend)).toEqual([]);
    }
    for (const p of heavy) {
      const surgical = clean.filter((c) => c.provider_id === p.id && isSurgical(c.procedure_codes, config));
      expect(surgical.length).toBeGreaterThanOrEqual(30);
    }
  });

  it('assigns claim_id in date order, so IDs do not cluster fraud', () => {
    const dates = data.claims.map((c) => c.claim_date);
    expect([...dates].sort()).toEqual(dates);
    expect(data.claims.map((c) => c.claim_id)).toEqual(
      data.claims.map((_, i) => `CLM-${String(i + 1).padStart(5, '0')}`),
    );
  });

  it('never uses Math.random in src/', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(join(root, 'src'));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('Math.random'))).toEqual([]);
  });
});
