import { describeCode } from '../codes.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * Flags procedure codes outside the valid list of the claim's diagnosis: the
 * union of its protocols plus the components of any bundle in them. A diagnosis
 * missing from the mapping is not flagged (Decision 7).
 */
export function dxProcedureMismatch(claim: Claim, ctx: RuleContext): Flag | null {
  const { config } = ctx;
  const valid = config.validProceduresByDx[claim.diagnosis_code];
  if (!valid) return null;

  const stray = claim.procedure_codes.filter((code) => !valid.includes(code));
  if (stray.length === 0) return null;

  const claimType = config.dxProtocols[claim.diagnosis_code]?.claim_type;
  const noun = stray.length === 1 ? 'procedure' : 'procedures';
  return {
    rule: 'dx_procedure_mismatch',
    severity: config.weights.dx_procedure_mismatch,
    evidence:
      `Diagnosis ${claim.diagnosis_code} (${claimType}) is billed with ${noun} ` +
      `${stray.map((code) => describeCode(code, config)).join(', ')} that it does not cover ` +
      `(${stray.length} of ${claim.procedure_codes.length} billed procedures, claim amount ${formatNumber(claim.submitted_amount)}). ` +
      `Valid procedures for ${claim.diagnosis_code} (${valid.length}): ${valid.map((code) => describeCode(code, config)).join(', ')}`,
  };
}
