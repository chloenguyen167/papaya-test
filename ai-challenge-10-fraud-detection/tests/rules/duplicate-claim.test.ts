import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { duplicateClaim } from '../../src/rules/duplicate-claim.js';
import type { Claim } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

/** claim_ids of the claims the rule flags, in input order. */
function flaggedIds(claims: Claim[]): string[] {
  const ctx = buildContext(claims, config);
  return claims.filter((c) => duplicateClaim(c, ctx) !== null).map((c) => c.claim_id);
}

describe('duplicateClaim', () => {
  it('flags only the copy with the larger claim_id when two claims are identical', () => {
    const original = makeClaim({ claim_id: 'CLM-00002' });
    const copy = makeClaim({ claim_id: 'CLM-00005' });
    expect(flaggedIds([original, copy])).toEqual(['CLM-00005']);
  });

  it('does not depend on the order claims appear in the dataset', () => {
    const original = makeClaim({ claim_id: 'CLM-00002' });
    const copy = makeClaim({ claim_id: 'CLM-00005' });
    expect(flaggedIds([copy, original])).toEqual(['CLM-00005']);
  });

  it('flags the two later copies when three claims are identical', () => {
    const claims = ['CLM-00003', 'CLM-00001', 'CLM-00002'].map((claim_id) => makeClaim({ claim_id }));
    expect(flaggedIds(claims)).toEqual(['CLM-00003', 'CLM-00002']);
  });

  it('does not flag claims with the same member + provider + date but a different diagnosis', () => {
    expect(flaggedIds([makeClaim(), makeClaim({ diagnosis_code: 'A09' })])).toEqual([]);
  });

  it('does not flag claims identical in everything but the provider', () => {
    expect(flaggedIds([makeClaim(), makeClaim({ provider_id: 'PRV-02' })])).toEqual([]);
  });

  it('does not flag claims identical in everything but the member or the date', () => {
    expect(flaggedIds([makeClaim(), makeClaim({ member_id: 'M-0002' }), makeClaim({ claim_date: '2024-03-07' })])).toEqual([]);
  });

  it('does not flag a claim that has no twin', () => {
    expect(flaggedIds([makeClaim()])).toEqual([]);
  });

  it('compares claim_id numerically, so CLM-10 is the copy of CLM-9', () => {
    const nine = makeClaim({ claim_id: 'CLM-9' });
    const ten = makeClaim({ claim_id: 'CLM-10' });
    expect(flaggedIds([ten, nine])).toEqual(['CLM-10']);
  });

  it('names the original, member, provider, date, diagnosis and the copy position in the evidence', () => {
    const claims = ['CLM-00001', 'CLM-00002', 'CLM-00003'].map((claim_id) => makeClaim({ claim_id }));
    const ctx = buildContext(claims, config);
    const flag = duplicateClaim(claims[2] as Claim, ctx);

    expect(flag?.rule).toBe('duplicate_claim');
    expect(flag?.severity).toBe(config.weights.duplicate_claim);
    for (const part of ['CLM-00001', 'M-0001', 'PRV-01', '2024-03-06', 'J06.9', 'copy 3 of 3']) {
      expect(flag?.evidence).toContain(part);
    }
    expect(duplicateClaim(claims[1] as Claim, ctx)?.evidence).toContain('copy 2 of 3');
  });
});
