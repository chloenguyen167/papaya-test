import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildContext, duplicateKey, memberDiagnosisKey, providerDayKey } from '../src/context.js';
import { makeClaim } from './helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', 'config'));

describe('makeClaim', () => {
  it('returns a weekday J06.9 + P-1001 claim of 800 with a fresh id each call', () => {
    const a = makeClaim();
    const b = makeClaim();
    expect(a).toMatchObject({ diagnosis_code: 'J06.9', procedure_codes: ['P-1001'], submitted_amount: 800, is_weekend: false });
    expect(a.claim_id).not.toBe(b.claim_id);
  });

  it('keeps is_weekend in step with an overridden date', () => {
    expect(makeClaim({ claim_date: '2024-03-09' }).is_weekend).toBe(true); // Saturday
  });
});

describe('buildContext', () => {
  it('groups duplicates by member + provider + date + diagnosis, ascending by claim_id', () => {
    const later = makeClaim({ claim_id: 'CLM-00009' });
    const original = makeClaim({ claim_id: 'CLM-00002' });
    const otherDx = makeClaim({ diagnosis_code: 'A09' });
    const otherDay = makeClaim({ claim_date: '2024-03-07' });
    const ctx = buildContext([later, original, otherDx, otherDay], config);

    expect(ctx.duplicateGroups.get(duplicateKey(original))).toEqual([original, later]);
    expect(ctx.duplicateGroups.get(duplicateKey(otherDx))).toEqual([otherDx]);
    expect(ctx.duplicateGroups.size).toBe(3);
  });

  it('orders a member + diagnosis history by date, across providers', () => {
    const late = makeClaim({ claim_id: 'CLM-00001', claim_date: '2024-03-20' });
    const early = makeClaim({ claim_id: 'CLM-00003', claim_date: '2024-03-06' });
    const sameDayLowerId = makeClaim({ claim_id: 'CLM-00002', claim_date: '2024-03-06', provider_id: 'PRV-02' });
    const otherMember = makeClaim({ member_id: 'M-0002' });
    const ctx = buildContext([late, early, sameDayLowerId, otherMember], config);

    expect(ctx.memberDiagnosisHistory.get(memberDiagnosisKey(early))).toEqual([sameDayLowerId, early, late]);
    expect(ctx.memberDiagnosisHistory.get(memberDiagnosisKey(otherMember))).toEqual([otherMember]);
  });

  it('groups claims by provider + date', () => {
    const a = makeClaim();
    const b = makeClaim({ member_id: 'M-0002' });
    const otherProvider = makeClaim({ provider_id: 'PRV-02' });
    const ctx = buildContext([a, b, otherProvider], config);

    expect(ctx.providerDayClaims.get(providerDayKey(a))).toEqual([a, b]);
    expect(ctx.providerDayClaims.get(providerDayKey(otherProvider))).toEqual([otherProvider]);
  });

  it('accumulates n, sum and sum of squares per sorted procedure combination', () => {
    const ctx = buildContext(
      [
        makeClaim({ procedure_codes: ['P-1002', 'P-1001'], submitted_amount: 1000 }),
        makeClaim({ procedure_codes: ['P-1001', 'P-1002'], submitted_amount: 2000 }),
        makeClaim({ procedure_codes: ['P-1001'], submitted_amount: 800 }),
      ],
      config,
    );

    expect(ctx.comboAmounts.get('P-1001+P-1002')).toEqual({ n: 2, sum: 3000, sumSquares: 5_000_000 });
    expect(ctx.comboAmounts.get('P-1001')).toEqual({ n: 1, sum: 800, sumSquares: 640_000 });
    expect(ctx.comboAmounts.size).toBe(2);
  });

  it('counts claims and weekend claims per provider, deriving weekends from the date', () => {
    const ctx = buildContext(
      [
        makeClaim(),
        makeClaim({ claim_date: '2024-03-09' }), // Saturday
        makeClaim({ claim_date: '2024-03-10' }), // Sunday
        makeClaim({ provider_id: 'PRV-02' }),
      ],
      config,
    );

    expect(ctx.providerWeekend.get('PRV-01')).toEqual({ claims: 3, weekendClaims: 2 });
    expect(ctx.providerWeekend.get('PRV-02')).toEqual({ claims: 1, weekendClaims: 0 });
  });

  it('handles an empty dataset', () => {
    const ctx = buildContext([], config);
    expect(ctx.duplicateGroups.size + ctx.comboAmounts.size + ctx.providerWeekend.size).toBe(0);
  });
});
