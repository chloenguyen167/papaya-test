import { duplicateKey } from '../context.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * Same member + provider + date + diagnosis. The group's smallest claim_id is
 * the original and is not flagged; every later copy is (Decision 1).
 */
export function duplicateClaim(claim: Claim, ctx: RuleContext): Flag | null {
  const group = ctx.duplicateGroups.get(duplicateKey(claim));
  const original = group?.[0];
  if (!group || !original) return null;

  const position = group.findIndex((c) => c.claim_id === claim.claim_id);
  if (position <= 0) return null;

  return {
    rule: 'duplicate_claim',
    severity: ctx.config.weights.duplicate_claim,
    evidence:
      `Duplicate of ${original.claim_id}: same member ${claim.member_id}, provider ${claim.provider_id}, ` +
      `date ${claim.claim_date}, diagnosis ${claim.diagnosis_code}; copy ${position + 1} of ${group.length}`,
  };
}
