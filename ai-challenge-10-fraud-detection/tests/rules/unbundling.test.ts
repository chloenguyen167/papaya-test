import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { unbundling } from '../../src/rules/unbundling.js';
import type { Claim } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

function evaluate(procedure_codes: string[]) {
  const claim: Claim = makeClaim({ procedure_codes });
  return unbundling(claim, buildContext([claim], config));
}

describe('unbundling', () => {
  it('flags all three components of B-9001 billed without the bundle code', () => {
    const flag = evaluate(['P-1002', 'P-1003', 'P-1004']);
    expect(flag?.rule).toBe('unbundling');
    expect(flag?.severity).toBe(config.weights.unbundling);
  });

  it('flags the components even when other codes are on the claim and in any order', () => {
    expect(evaluate(['P-1004', 'P-1001', 'P-1002', 'P-1003'])).not.toBeNull();
  });

  it('does not flag when one of the three components is missing', () => {
    expect(evaluate(['P-1002', 'P-1003'])).toBeNull();
    expect(evaluate(['P-1002', 'P-1004'])).toBeNull();
    expect(evaluate(['P-1003', 'P-1004'])).toBeNull();
  });

  it('does not flag a consultation plus a blood count (2 of the 4 components of B-9005)', () => {
    expect(evaluate(['P-1001', 'P-1002'])).toBeNull();
  });

  it('does not flag the bundle code billed without its components', () => {
    expect(evaluate(['B-9001'])).toBeNull();
  });

  it('flags the bundle code together with all its components and says they are billed twice', () => {
    const flag = evaluate(['B-9001', 'P-1002', 'P-1003', 'P-1004']);
    expect(flag).not.toBeNull();
    expect(flag?.evidence).toContain('twice');
    expect(flag?.evidence).toContain('B-9001');
  });

  it('does not flag a claim with no bundle components at all', () => {
    expect(evaluate(['P-1001'])).toBeNull();
  });

  it('puts the found components, the bundle to use, its price and the itemized total in the evidence', () => {
    const evidence = evaluate(['P-1002', 'P-1003', 'P-1004'])?.evidence ?? '';
    for (const part of ['P-1002', 'P-1003', 'P-1004', 'B-9001', 'Basic blood panel', '1,000', '1,200']) {
      expect(evidence).toContain(part);
    }
    expect(evidence).not.toContain('twice');
  });

  it('reports every bundle that is fully split, not just the first', () => {
    // P-1001 + P-1002 + P-1005 + P-1006 completes B-9005; P-1002 + P-1003 + P-1004 completes B-9001.
    const evidence = evaluate(['P-1001', 'P-1002', 'P-1003', 'P-1004', 'P-1005', 'P-1006'])?.evidence ?? '';
    expect(evidence).toContain('B-9001');
    expect(evidence).toContain('B-9005');
  });

  it('flags a split appendectomy package (P-2001 + P-2002) using the 36,000 package price', () => {
    const evidence = evaluate(['P-2001', 'P-2002'])?.evidence ?? '';
    expect(evidence).toContain('B-9002');
    expect(evidence).toContain('36,000');
    expect(evidence).toContain('38,000');
  });
});
