import { isWeekend } from '../dates.js';
import type { Claim, FraudLabel, RuleName } from '../types.js';
import type { GenContext } from './context.js';

export interface Dataset {
  claims: Claim[];
  labels: FraudLabel[];
}

/**
 * Shuffle, stable-sort by date, THEN assign claim_id (Decision 10). Within a
 * duplicate pair the label goes to whichever claim got the larger claim_id (Decision 1).
 */
export function finalize(ctx: GenContext): Dataset {
  const names = new Map(ctx.providers.map((p) => [p.id, p.name]));
  const order = ctx.rng
    .shuffle([...ctx.ledger.drafts])
    .sort((a, b) => (a.claim_date < b.claim_date ? -1 : a.claim_date > b.claim_date ? 1 : 0));

  const idOf = new Map(order.map((d, i) => [d.key, `CLM-${String(i + 1).padStart(5, '0')}`]));
  const labelOf = new Map<number, RuleName | null>(order.map((d) => [d.key, d.label]));
  for (const d of order) {
    if (d.copyOf === null) continue;
    if ((idOf.get(d.copyOf) ?? '') > (idOf.get(d.key) ?? '')) {
      labelOf.set(d.key, null);
      labelOf.set(d.copyOf, 'duplicate_claim');
    }
  }

  const claims: Claim[] = order.map((d) => ({
    claim_id: idOf.get(d.key) ?? '',
    member_id: d.member_id,
    provider_id: d.provider_id,
    provider_name: names.get(d.provider_id) ?? '',
    claim_date: d.claim_date,
    claim_type: d.claim_type,
    diagnosis_code: d.diagnosis_code,
    procedure_codes: [...d.procedure_codes],
    submitted_amount: d.submitted_amount,
    is_weekend: isWeekend(d.claim_date),
  }));
  const labels: FraudLabel[] = order.map((d) => ({
    claim_id: idOf.get(d.key) ?? '',
    fraud_type: labelOf.get(d.key) ?? 'clean',
  }));
  return { claims, labels };
}
