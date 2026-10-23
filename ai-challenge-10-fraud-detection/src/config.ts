import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAIM_TYPES,
  RULE_NAMES,
  type Bundle,
  type ClaimType,
  type Config,
  type DiagnosisProtocols,
  type Procedure,
  type ProcedureCategory,
  type RuleName,
  type Thresholds,
} from './types.js';

export const CONFIG_FILES = {
  procedures: 'procedures.json',
  bundles: 'bundles.json',
  dxProcedureMap: 'dx-procedure-map.json',
  thresholds: 'thresholds.json',
} as const;

const PROCEDURE_CATEGORIES: readonly ProcedureCategory[] = ['medical', 'surgical', 'dental'];

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid config:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

export interface RawConfig {
  procedures: unknown;
  bundles: unknown;
  dxProcedureMap: unknown;
  thresholds: unknown;
}

/** Collects every problem with its full key path so one run reports them all. */
class Validator {
  readonly problems: string[] = [];

  fail(path: string, message: string): void {
    this.problems.push(`${path}: ${message}`);
  }

  object(value: unknown, path: string): Record<string, unknown> | undefined {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    this.fail(path, value === undefined ? 'missing' : 'must be an object');
    return undefined;
  }

  number(obj: Record<string, unknown>, key: string, path: string): number {
    const value = obj[key];
    if (value === undefined) {
      this.fail(`${path}.${key}`, 'missing');
      return Number.NaN;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      this.fail(`${path}.${key}`, `must be a number, got ${JSON.stringify(value)}`);
      return Number.NaN;
    }
    return value;
  }

  string(obj: Record<string, unknown>, key: string, path: string): string {
    const value = obj[key];
    if (typeof value === 'string' && value.length > 0) return value;
    this.fail(`${path}.${key}`, value === undefined ? 'missing' : 'must be a non-empty string');
    return '';
  }

  stringArray(value: unknown, path: string): string[] {
    if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string')) {
      return value as string[];
    }
    this.fail(path, value === undefined ? 'missing' : 'must be a non-empty array of strings');
    return [];
  }

  oneOf<T extends string>(obj: Record<string, unknown>, key: string, allowed: readonly T[], path: string): T {
    const value = obj[key];
    if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
    this.fail(
      `${path}.${key}`,
      value === undefined ? 'missing' : `must be one of ${allowed.join(', ')}, got ${JSON.stringify(value)}`,
    );
    return allowed[0] as T;
  }
}

function parseProcedures(v: Validator, raw: unknown, file: string): Record<string, Procedure> {
  const result: Record<string, Procedure> = {};
  const root = v.object(raw, file);
  if (!root) return result;
  for (const [code, entry] of Object.entries(root)) {
    const path = `${file} ${code}`;
    const obj = v.object(entry, path);
    if (!obj) continue;
    result[code] = {
      name: v.string(obj, 'name', path),
      category: v.oneOf(obj, 'category', PROCEDURE_CATEGORIES, path),
      reference_price: v.number(obj, 'reference_price', path),
    };
  }
  return result;
}

function parseBundles(v: Validator, raw: unknown, file: string): Record<string, Bundle> {
  const result: Record<string, Bundle> = {};
  const root = v.object(raw, file);
  if (!root) return result;
  for (const [code, entry] of Object.entries(root)) {
    const path = `${file} ${code}`;
    const obj = v.object(entry, path);
    if (!obj) continue;
    result[code] = {
      name: v.string(obj, 'name', path),
      components: v.stringArray(obj['components'], `${path}.components`),
      price: v.number(obj, 'price', path),
    };
  }
  return result;
}

function parseDxProtocols(v: Validator, raw: unknown, file: string): Record<string, DiagnosisProtocols> {
  const result: Record<string, DiagnosisProtocols> = {};
  const root = v.object(raw, file);
  if (!root) return result;
  for (const [dx, entry] of Object.entries(root)) {
    const path = `${file} ${dx}`;
    const obj = v.object(entry, path);
    if (!obj) continue;
    const claimType: ClaimType = v.oneOf(obj, 'claim_type', CLAIM_TYPES, path);
    const rawProtocols = obj['protocols'];
    const protocols: string[][] = [];
    if (!Array.isArray(rawProtocols) || rawProtocols.length === 0) {
      v.fail(`${path}.protocols`, rawProtocols === undefined ? 'missing' : 'must be a non-empty array');
    } else {
      rawProtocols.forEach((p, i) => protocols.push(v.stringArray(p, `${path}.protocols[${i}]`)));
    }
    result[dx] = { claim_type: claimType, protocols };
  }
  return result;
}

function parseWeights(v: Validator, root: Record<string, unknown>, file: string): Record<RuleName, number> {
  const path = `${file} weights`;
  const obj = v.object(root['weights'], path);
  const weights = {} as Record<RuleName, number>;
  for (const rule of RULE_NAMES) {
    if (!obj) {
      weights[rule] = Number.NaN;
      continue;
    }
    if (obj[rule] === undefined) {
      v.fail(`${path}.${rule}`, 'missing weight');
      weights[rule] = Number.NaN;
      continue;
    }
    const w = v.number(obj, rule, path);
    if (!Number.isNaN(w) && !(Number.isInteger(w) && w >= 1 && w <= 5)) {
      v.fail(`${path}.${rule}`, `weight must be an integer from 1 to 5, got ${w}`);
    }
    weights[rule] = w;
  }
  if (obj) {
    for (const key of Object.keys(obj)) {
      if (!(RULE_NAMES as readonly string[]).includes(key)) v.fail(`${path}.${key}`, 'unknown rule name');
    }
  }
  return weights;
}

function parseThresholds(v: Validator, root: Record<string, unknown>, file: string): Thresholds {
  const base = `${file} rules`;
  const rules = v.object(root['rules'], base) ?? {};
  const section = (name: keyof Thresholds): Record<string, unknown> => v.object(rules[name], `${base}.${name}`) ?? {};

  const rapid = section('rapid_resubmission');
  const upcoding = section('upcoding');
  const phantom = section('phantom_billing');
  const weekend = section('weekend_anomaly');
  const clustering = section('amount_clustering');

  const t: Thresholds = {
    rapid_resubmission: {
      min_gap_days: v.number(rapid, 'min_gap_days', `${base}.rapid_resubmission`),
      max_gap_days: v.number(rapid, 'max_gap_days', `${base}.rapid_resubmission`),
    },
    upcoding: {
      z_threshold: v.number(upcoding, 'z_threshold', `${base}.upcoding`),
      min_group_size: v.number(upcoding, 'min_group_size', `${base}.upcoding`),
    },
    phantom_billing: {
      max_claims_per_provider_day: v.number(phantom, 'max_claims_per_provider_day', `${base}.phantom_billing`),
    },
    weekend_anomaly: {
      max_weekend_share: v.number(weekend, 'max_weekend_share', `${base}.weekend_anomaly`),
      min_provider_claims: v.number(weekend, 'min_provider_claims', `${base}.weekend_anomaly`),
    },
    amount_clustering: {
      auto_approval_threshold: v.number(clustering, 'auto_approval_threshold', `${base}.amount_clustering`),
      min_amount: v.number(clustering, 'min_amount', `${base}.amount_clustering`),
      max_amount: v.number(clustering, 'max_amount', `${base}.amount_clustering`),
    },
  };

  if (t.rapid_resubmission.min_gap_days > t.rapid_resubmission.max_gap_days) {
    v.fail(`${base}.rapid_resubmission`, 'min_gap_days must be <= max_gap_days');
  }
  const share = t.weekend_anomaly.max_weekend_share;
  if (share < 0 || share > 1) v.fail(`${base}.weekend_anomaly.max_weekend_share`, `must be in [0, 1], got ${share}`);
  const c = t.amount_clustering;
  if (c.min_amount > c.max_amount) v.fail(`${base}.amount_clustering`, 'min_amount must be <= max_amount');
  if (c.max_amount >= c.auto_approval_threshold) {
    v.fail(`${base}.amount_clustering.max_amount`, 'must be below auto_approval_threshold');
  }
  return t;
}

function checkCodeReferences(
  v: Validator,
  procedures: Record<string, Procedure>,
  bundles: Record<string, Bundle>,
  dxProtocols: Record<string, DiagnosisProtocols>,
): void {
  for (const [code, bundle] of Object.entries(bundles)) {
    for (const c of bundle.components) {
      if (!procedures[c]) v.fail(`${CONFIG_FILES.bundles} ${code}.components`, `unknown procedure code ${c}`);
    }
  }
  for (const [dx, entry] of Object.entries(dxProtocols)) {
    entry.protocols.forEach((protocol, i) => {
      for (const c of protocol) {
        if (!procedures[c] && !bundles[c]) {
          v.fail(`${CONFIG_FILES.dxProcedureMap} ${dx}.protocols[${i}]`, `unknown procedure or bundle code ${c}`);
        }
      }
    });
  }
}

/** Valid procedures per diagnosis = union of its protocol codes plus components of any bundle in them (Decision 7). */
export function deriveValidProcedures(
  dxProtocols: Record<string, DiagnosisProtocols>,
  bundles: Record<string, Bundle>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [dx, entry] of Object.entries(dxProtocols)) {
    const codes = new Set<string>();
    for (const protocol of entry.protocols) {
      for (const code of protocol) {
        codes.add(code);
        for (const component of bundles[code]?.components ?? []) codes.add(component);
      }
    }
    result[dx] = [...codes].sort();
  }
  return result;
}

export function parseConfig(raw: RawConfig): Config {
  const v = new Validator();
  const procedures = parseProcedures(v, raw.procedures, CONFIG_FILES.procedures);
  const bundles = parseBundles(v, raw.bundles, CONFIG_FILES.bundles);
  const dxProtocols = parseDxProtocols(v, raw.dxProcedureMap, CONFIG_FILES.dxProcedureMap);
  const thresholdsRoot = v.object(raw.thresholds, CONFIG_FILES.thresholds) ?? {};
  const weights = parseWeights(v, thresholdsRoot, CONFIG_FILES.thresholds);
  const thresholds = parseThresholds(v, thresholdsRoot, CONFIG_FILES.thresholds);
  checkCodeReferences(v, procedures, bundles, dxProtocols);

  if (v.problems.length > 0) throw new ConfigError(v.problems);

  return {
    procedures,
    bundles,
    dxProtocols,
    validProceduresByDx: deriveValidProcedures(dxProtocols, bundles),
    weights,
    thresholds,
  };
}

function readJson(dir: string, file: string): unknown {
  const path = join(dir, file);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new ConfigError([`${file}: cannot read ${path}`]);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new ConfigError([`${file}: invalid JSON (${(err as Error).message})`]);
  }
}

export function loadConfig(dir = 'config'): Config {
  return parseConfig({
    procedures: readJson(dir, CONFIG_FILES.procedures),
    bundles: readJson(dir, CONFIG_FILES.bundles),
    dxProcedureMap: readJson(dir, CONFIG_FILES.dxProcedureMap),
    thresholds: readJson(dir, CONFIG_FILES.thresholds),
  });
}
