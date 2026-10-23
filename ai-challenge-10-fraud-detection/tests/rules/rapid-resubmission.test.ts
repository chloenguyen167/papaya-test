import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { rapidResubmission } from '../../src/rules/rapid-resubmission.js';
import type { Claim } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

/** Dates shifted from 2024-03-06 by whole days. */
const BASE = '2024-03-06';
const day = (offset: number): string => new Date(Date.UTC(2024, 2, 6 + offset)).toISOString().slice(0, 10);

function flaggedIds(claims: Claim[]): string[] {
  const ctx = buildContext(claims, config);
  return claims.filter((c) => rapidResubmission(c, ctx) !== null).map((c) => c.claim_id);
}

describe('rapidResubmission', () => {
  it('does not flag a gap of 0 days (left to the duplicate rule)', () => {
    expect(flaggedIds([makeClaim(), makeClaim({ provider_id: 'PRV-02' })])).toEqual([]);
  });

  it('flags the later claim at a gap of 1 day and not the earlier one', () => {
    const first = makeClaim({ claim_id: 'CLM-00001', claim_date: BASE });
    const second = makeClaim({ claim_id: 'CLM-00002', claim_date: day(1) });
    expect(flaggedIds([first, second])).toEqual(['CLM-00002']);
  });

  it('flags a gap of 7 days', () => {
    expect(flaggedIds([makeClaim({ claim_date: BASE }), makeClaim({ claim_id: 'CLM-LATE', claim_date: day(7) })])).toEqual(['CLM-LATE']);
  });

  it('does not flag a gap of 8 days', () => {
    expect(flaggedIds([makeClaim({ claim_date: BASE }), makeClaim({ claim_date: day(8) })])).toEqual([]);
  });

  it('does not flag a different diagnosis', () => {
    expect(flaggedIds([makeClaim({ claim_date: BASE }), makeClaim({ claim_date: day(2), diagnosis_code: 'A09' })])).toEqual([]);
  });

  it('does not flag a different member', () => {
    expect(flaggedIds([makeClaim({ claim_date: BASE }), makeClaim({ claim_date: day(2), member_id: 'M-0002' })])).toEqual([]);
  });

  it('matches across providers (the rule is member + diagnosis)', () => {
    const second = makeClaim({ claim_id: 'CLM-OTHER', claim_date: day(2), provider_id: 'PRV-02' });
    expect(flaggedIds([makeClaim({ claim_date: BASE }), second])).toEqual(['CLM-OTHER']);
  });

  it('never flags the first claim of a chain, whatever order claims arrive in', () => {
    const first = makeClaim({ claim_id: 'CLM-00001', claim_date: BASE });
    const second = makeClaim({ claim_id: 'CLM-00002', claim_date: day(3) });
    expect(flaggedIds([second, first])).toEqual(['CLM-00002']);
  });

  it('compares each claim of a 3-day chain with the one right before it', () => {
    const claims = [0, 3, 6].map((offset, i) => makeClaim({ claim_id: `CLM-0000${i + 1}`, claim_date: day(offset) }));
    expect(flaggedIds(claims)).toEqual(['CLM-00002', 'CLM-00003']);
  });

  it('uses the immediately preceding claim, not the first one in the chain', () => {
    // Gaps 7 and 7: the third claim is 14 days after the first but only 7 after the second.
    const claims = [0, 7, 14].map((offset, i) => makeClaim({ claim_id: `CLM-0000${i + 1}`, claim_date: day(offset) }));
    expect(flaggedIds(claims)).toEqual(['CLM-00002', 'CLM-00003']);
  });

  it('counts 2024-01-30 to 2024-02-02 as 3 days across the month end', () => {
    const first = makeClaim({ claim_id: 'CLM-00001', claim_date: '2024-01-30' });
    const second = makeClaim({ claim_id: 'CLM-00002', claim_date: '2024-02-02' });
    const ctx = buildContext([first, second], config);
    expect(rapidResubmission(second, ctx)?.evidence).toContain('3 days');
  });

  it('counts a gap across 29 February in a leap year', () => {
    const first = makeClaim({ claim_id: 'CLM-00001', claim_date: '2024-02-28' });
    const second = makeClaim({ claim_id: 'CLM-00002', claim_date: '2024-03-02' });
    expect(rapidResubmission(second, buildContext([first, second], config))?.evidence).toContain('3 days');
  });

  it('puts the previous claim_id and date, the diagnosis and the gap in the evidence', () => {
    const first = makeClaim({ claim_id: 'CLM-00001', claim_date: BASE });
    const second = makeClaim({ claim_id: 'CLM-00002', claim_date: day(1) });
    const flag = rapidResubmission(second, buildContext([first, second], config));

    expect(flag?.rule).toBe('rapid_resubmission');
    expect(flag?.severity).toBe(config.weights.rapid_resubmission);
    for (const part of ['CLM-00001', BASE, 'J06.9', '1 day']) expect(flag?.evidence).toContain(part);
    expect(flag?.evidence).not.toContain('1 days');
  });
});
