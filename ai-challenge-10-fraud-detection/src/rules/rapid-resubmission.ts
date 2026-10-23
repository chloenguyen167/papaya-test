import { memberDiagnosisKey } from '../context.js';
import { diffDays } from '../dates.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * Same member + diagnosis as the immediately preceding claim, 1–7 days earlier
 * (Decision 2). A gap of 0 is left to the duplicate rule. The first claim of a
 * chain is never flagged.
 */
export function rapidResubmission(claim: Claim, ctx: RuleContext): Flag | null {
  const history = ctx.memberDiagnosisHistory.get(memberDiagnosisKey(claim));
  if (!history) return null;

  const position = history.findIndex((c) => c.claim_id === claim.claim_id);
  const previous = position > 0 ? history[position - 1] : undefined;
  if (!previous) return null;

  const { min_gap_days, max_gap_days } = ctx.config.thresholds.rapid_resubmission;
  const gap = diffDays(previous.claim_date, claim.claim_date);
  if (gap < min_gap_days || gap > max_gap_days) return null;

  return {
    rule: 'rapid_resubmission',
    severity: ctx.config.weights.rapid_resubmission,
    evidence:
      `Same member ${claim.member_id} and diagnosis ${claim.diagnosis_code} as ${previous.claim_id} ` +
      `(${previous.claim_date}), resubmitted ${gap} ${gap === 1 ? 'day' : 'days'} later ` +
      `(window ${min_gap_days}–${max_gap_days} days)`,
  };
}
