import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { dxProcedureMismatch } from '../../src/rules/dx-procedure-mismatch.js';
import type { Claim } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

function evaluate(claim: Claim) {
  return dxProcedureMismatch(claim, buildContext([claim], config));
}

describe('dxProcedureMismatch', () => {
  it('flags J06.9 billed with P-2001 (appendectomy)', () => {
    const flag = evaluate(makeClaim({ procedure_codes: ['P-2001'] }));
    expect(flag?.rule).toBe('dx_procedure_mismatch');
    expect(flag?.severity).toBe(config.weights.dx_procedure_mismatch);
  });

  it('does not flag J06.9 billed with P-1001', () => {
    expect(evaluate(makeClaim())).toBeNull();
  });

  it('does not flag a diagnosis that is not in the mapping (Decision 7)', () => {
    expect(evaluate(makeClaim({ diagnosis_code: 'Z99.9', procedure_codes: ['P-2001'] }))).toBeNull();
  });

  it('does not flag the components of bundle B-9001 billed separately under E11.9', () => {
    expect(evaluate(makeClaim({ diagnosis_code: 'E11.9', procedure_codes: ['P-1002', 'P-1003', 'P-1004'] }))).toBeNull();
  });

  it('does not flag a bundle code that appears in the diagnosis protocol', () => {
    const claim = makeClaim({ diagnosis_code: 'Z00.0', procedure_codes: ['B-9005'] });
    expect(evaluate(claim)).toBeNull();
  });

  it('flags a claim with one valid and one stray code, naming only the stray one', () => {
    const flag = evaluate(makeClaim({ procedure_codes: ['P-1001', 'P-2001'] }));
    const [stray = ''] = (flag?.evidence ?? '').split('Valid procedures');
    expect(stray).toContain('P-2001');
    expect(stray).not.toContain('P-1001');
  });

  it('names every stray code when there are several', () => {
    const [stray = ''] = (evaluate(makeClaim({ procedure_codes: ['P-1001', 'P-2001', 'P-3004'] }))?.evidence ?? '').split('Valid procedures');
    expect(stray).toContain('P-2001');
    expect(stray).toContain('P-3004');
  });

  it('puts the diagnosis, the stray code with its name, and the valid list in the evidence', () => {
    const evidence = evaluate(makeClaim({ procedure_codes: ['P-2001'] }))?.evidence ?? '';
    expect(evidence).toContain('J06.9');
    expect(evidence).toContain('OUTPATIENT');
    expect(evidence).toContain('P-2001 (Appendectomy)');
    expect(evidence).toContain('P-1001 (Consultation)');
    expect(evidence).toContain('P-1002 (Complete blood count)');
  });

  it('lists bundle components and bundle codes among the valid procedures with their names', () => {
    const evidence = evaluate(makeClaim({ diagnosis_code: 'E11.9', procedure_codes: ['P-2001'] }))?.evidence ?? '';
    expect(evidence).toContain('B-9001 (Basic blood panel)');
    expect(evidence).toContain('P-1003 (Blood glucose)');
  });
});
