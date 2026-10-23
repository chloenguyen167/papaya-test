import { comboKey } from './codes.js';
import { isWeekend } from './dates.js';
import type { AmountAggregate, Claim, Config, RuleContext, WeekendTally } from './types.js';

export function duplicateKey(claim: Claim): string {
  return [claim.member_id, claim.provider_id, claim.claim_date, claim.diagnosis_code].join('|');
}

export function memberDiagnosisKey(claim: Claim): string {
  return `${claim.member_id}|${claim.diagnosis_code}`;
}

export function providerDayKey(claim: Claim): string {
  return `${claim.provider_id}|${claim.claim_date}`;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Builds every dataset-wide index the rules need in one pass over `claims`.
 * Only the per-group ordering (needed by Decision 1 and the rapid re-submission
 * look-back) is done afterwards, and only within groups.
 */
export function buildContext(claims: readonly Claim[], config: Config): RuleContext {
  const duplicateGroups = new Map<string, Claim[]>();
  const memberDiagnosisHistory = new Map<string, Claim[]>();
  const providerDayClaims = new Map<string, Claim[]>();
  const comboAmounts = new Map<string, AmountAggregate>();
  const providerWeekend = new Map<string, WeekendTally>();

  for (const claim of claims) {
    push(duplicateGroups, duplicateKey(claim), claim);
    push(memberDiagnosisHistory, memberDiagnosisKey(claim), claim);
    push(providerDayClaims, providerDayKey(claim), claim);

    const combo = comboKey(claim.procedure_codes);
    const aggregate = comboAmounts.get(combo);
    if (aggregate) {
      aggregate.n += 1;
      aggregate.sum += claim.submitted_amount;
      aggregate.sumSquares += claim.submitted_amount ** 2;
    } else {
      comboAmounts.set(combo, { n: 1, sum: claim.submitted_amount, sumSquares: claim.submitted_amount ** 2 });
    }

    const tally = providerWeekend.get(claim.provider_id) ?? { claims: 0, weekendClaims: 0 };
    tally.claims += 1;
    if (isWeekend(claim.claim_date)) tally.weekendClaims += 1;
    providerWeekend.set(claim.provider_id, tally);
  }

  for (const group of duplicateGroups.values()) {
    group.sort((a, b) => compareText(a.claim_id, b.claim_id));
  }
  for (const history of memberDiagnosisHistory.values()) {
    history.sort((a, b) => compareText(a.claim_date, b.claim_date) || compareText(a.claim_id, b.claim_id));
  }

  return { claims, config, duplicateGroups, memberDiagnosisHistory, providerDayClaims, comboAmounts, providerWeekend };
}
