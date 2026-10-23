import { describe, expect, it } from 'vitest';
import { claimsFromCsv, claimsToCsv, escapeField, parseCsv } from '../src/csv.js';
import type { Claim } from '../src/types.js';

const claim: Claim = {
  claim_id: 'CLM-00001',
  member_id: 'M-0001',
  provider_id: 'PRV-01',
  provider_name: 'Bangkok General Hospital',
  claim_date: '2024-03-05',
  claim_type: 'OUTPATIENT',
  diagnosis_code: 'J06.9',
  procedure_codes: ['P-1001', 'P-1002'],
  submitted_amount: 1210,
  is_weekend: false,
};

describe('csv', () => {
  it('quotes fields with commas or double quotes per RFC 4180', () => {
    expect(escapeField('plain')).toBe('plain');
    expect(escapeField('Clinic, Ltd')).toBe('"Clinic, Ltd"');
    expect(escapeField('St "Mary" Clinic')).toBe('"St ""Mary"" Clinic"');
  });

  it('round-trips claims including names with commas, quotes and line breaks', () => {
    const tricky: Claim = { ...claim, claim_id: 'CLM-00002', provider_name: 'St "Mary", Clinic\nBranch 2' };
    const text = claimsToCsv([claim, tricky]);
    expect(text).toContain('P-1001|P-1002');
    expect(claimsFromCsv(text)).toEqual([claim, tricky]);
  });

  it('round-trips an empty procedure list', () => {
    const empty: Claim = { ...claim, procedure_codes: [] };
    expect(claimsFromCsv(claimsToCsv([empty]))).toEqual([empty]);
  });

  it('parses LF line endings and a missing trailing newline', () => {
    expect(parseCsv('a,b\n"x,y",z')).toEqual([
      ['a', 'b'],
      ['x,y', 'z'],
    ]);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/);
  });

  it('rejects a malformed date with the record number', () => {
    const text = claimsToCsv([{ ...claim, claim_date: '05/03/2024' }]);
    expect(() => claimsFromCsv(text)).toThrow(/record 1: claim_date must be YYYY-MM-DD/);
  });
});
