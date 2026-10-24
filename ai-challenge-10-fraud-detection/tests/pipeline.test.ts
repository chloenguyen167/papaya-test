import { describe, expect, it } from 'vitest';
import { compareDirFor, parseSeed, resultsDirFor } from '../src/pipeline.js';

describe('resultsDirFor', () => {
  it('maps data → output and data/<name> → output/<name>', () => {
    expect(resultsDirFor('data')).toBe('output');
    expect(resultsDirFor('data/')).toBe('output');
    expect(resultsDirFor('data/holdout')).toBe('output/holdout');
  });

  it('rejects directories outside data/', () => {
    expect(() => resultsDirFor('elsewhere')).toThrow('inside it');
    expect(() => resultsDirFor('/tmp/data')).toThrow('inside it');
  });
});

describe('compareDirFor', () => {
  it('pairs the baseline with output/holdout and every other run with the baseline', () => {
    expect(compareDirFor('output')).toBe('output/holdout');
    expect(compareDirFor('output/holdout')).toBe('output');
  });
});

describe('parseSeed', () => {
  it('accepts integers in [0, 2^32)', () => {
    expect([parseSeed('0'), parseSeed('7'), parseSeed('4294967295')]).toEqual([0, 7, 4294967295]);
  });

  it('rejects anything else', () => {
    for (const bad of ['', ' ', '-1', '1.5', 'abc', '4294967296']) expect(() => parseSeed(bad)).toThrow('--seed');
  });
});
