import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/cli.js';

const defaults = { labels: 'data/labels.csv', out: 'output' };
const usage = 'Usage: report [--labels PATH] [--out DIR]';

describe('parseFlags', () => {
  it('returns the defaults when no flags are given', () => {
    expect(parseFlags([], defaults, usage)).toEqual(defaults);
  });

  it('accepts "--flag value" and "--flag=value", keeping any later "=" in the value', () => {
    expect(parseFlags(['--out', 'holdout', '--labels=a=b.csv'], defaults, usage)).toEqual({ labels: 'a=b.csv', out: 'holdout' });
  });

  it('rejects unknown flags and positional arguments, quoting the usage', () => {
    expect(() => parseFlags(['--seed', '7'], defaults, usage)).toThrow(`Unknown argument "--seed". ${usage}`);
    expect(() => parseFlags(['output'], defaults, usage)).toThrow('Unknown argument "output"');
  });

  it('rejects a flag without a value', () => {
    expect(() => parseFlags(['--out'], defaults, usage)).toThrow('--out needs a value');
    expect(() => parseFlags(['--out='], defaults, usage)).toThrow('--out needs a value');
    expect(() => parseFlags(['--out', '--labels', 'x'], defaults, usage)).toThrow('--out needs a value');
  });
});
