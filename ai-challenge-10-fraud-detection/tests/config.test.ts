import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_FILES, ConfigError, loadConfig, parseConfig, type RawConfig } from '../src/config.js';

const dir = join(import.meta.dirname, '..', 'config');
const read = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8')) as unknown;

function rawConfig(): RawConfig {
  return {
    procedures: read(CONFIG_FILES.procedures),
    bundles: read(CONFIG_FILES.bundles),
    dxProcedureMap: read(CONFIG_FILES.dxProcedureMap),
    thresholds: read(CONFIG_FILES.thresholds),
  };
}

function thresholdsOf(raw: RawConfig): { weights: Record<string, unknown>; rules: Record<string, Record<string, unknown>> } {
  return raw.thresholds as { weights: Record<string, unknown>; rules: Record<string, Record<string, unknown>> };
}

describe('config', () => {
  it('loads the shipped config', () => {
    const config = loadConfig(dir);
    expect(config.weights.upcoding).toBe(4);
    expect(config.thresholds.amount_clustering.min_amount).toBe(47500);
  });

  it('includes bundle components in the valid procedures of a diagnosis', () => {
    const config = loadConfig(dir);
    expect(config.validProceduresByDx['E11.9']).toEqual(['B-9001', 'P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1010']);
  });

  it('names the missing weight', () => {
    const raw = rawConfig();
    delete thresholdsOf(raw).weights['upcoding'];
    expect(() => parseConfig(raw)).toThrow('thresholds.json weights.upcoding: missing weight');
  });

  it('names the missing threshold', () => {
    const raw = rawConfig();
    delete thresholdsOf(raw).rules['phantom_billing']!['max_claims_per_provider_day'];
    expect(() => parseConfig(raw)).toThrow('thresholds.json rules.phantom_billing.max_claims_per_provider_day: missing');
  });

  it('reports every problem at once', () => {
    const raw = rawConfig();
    const t = thresholdsOf(raw);
    t.weights['amount_clustering'] = 7;
    delete t.rules['upcoding'];
    try {
      parseConfig(raw);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as ConfigError).problems).toEqual([
        'thresholds.json weights.amount_clustering: weight must be an integer from 1 to 5, got 7',
        'thresholds.json rules.upcoding: missing',
        'thresholds.json rules.upcoding.z_threshold: missing',
        'thresholds.json rules.upcoding.min_group_size: missing',
      ]);
    }
  });
});
