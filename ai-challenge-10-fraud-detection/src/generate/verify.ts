import { comboKey, isSurgical } from '../codes.js';
import { dayNumber, isValidIsoDate, isWeekend } from '../dates.js';
import { leaveOneOutStats, sampleStats } from '../stats.js';
import { RULE_NAMES, type Claim, type Config, type FraudLabel } from '../types.js';
import { inClusteringBand } from './amounts.js';
import type { Dataset } from './finalize.js';
import type { PhantomInfo } from './inject.js';
import { PARAMS } from './params.js';
import { isHospital, isScheduled, type Provider } from './providers.js';

/**
 * Invariants of the final dataset (DATA_DESIGN.md §F). Throws listing every
 * violation; the generator never repairs data silently.
 */
export function verifyDataset(
  { claims, labels }: Dataset,
  providers: readonly Provider[],
  config: Config,
  phantom: PhantomInfo,
): void {
  const problems: string[] = [];
  const fail = (msg: string): void => {
    problems.push(msg);
  };
  const labelOf = new Map(labels.map((l) => [l.claim_id, l.fraud_type]));
  const typeOf = (c: Claim): FraudLabel['fraud_type'] => labelOf.get(c.claim_id) ?? 'clean';
  const clean = claims.filter((c) => typeOf(c) === 'clean');
  const byProvider = new Map(providers.map((p) => [p.id, p]));

  // Counts.
  if (clean.length !== PARAMS.clean.total) fail(`clean claims: ${clean.length}, expected ${PARAMS.clean.total}`);
  for (const rule of RULE_NAMES) {
    const n = claims.filter((c) => typeOf(c) === rule).length;
    if (n !== PARAMS.fraudCounts[rule]) fail(`${rule}: ${n} claims, expected ${PARAMS.fraudCounts[rule]}`);
  }

  // Dates.
  for (const c of claims) {
    if (!isValidIsoDate(c.claim_date) || !c.claim_date.startsWith(`${PARAMS.year}-`)) fail(`${c.claim_id}: date ${c.claim_date} outside ${PARAMS.year}`);
    else if (c.is_weekend !== isWeekend(c.claim_date)) fail(`${c.claim_id}: is_weekend does not match ${c.claim_date}`);
  }

  // Clean claims: no clustering amounts, member + diagnosis spacing (Decisions 12, 18).
  for (const c of clean) if (inClusteringBand(c.submitted_amount, config)) fail(`${c.claim_id}: clean amount ${c.submitted_amount} in clustering band`);
  const cleanByMemberDx = groupBy(clean, (c) => `${c.member_id}|${c.diagnosis_code}`);
  for (const [key, group] of cleanByMemberDx) {
    const days = group.map((c) => dayNumber(c.claim_date)).sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      const gap = (days[i] ?? 0) - (days[i - 1] ?? 0);
      if (gap < PARAMS.minSameDxGapDays) fail(`clean claims ${key} only ${gap} days apart`);
    }
  }

  // Weekend rule setup (Decisions 14, 17).
  const byProviderClaims = groupBy(claims, (c) => c.provider_id);
  for (const p of providers.filter(isHospital)) {
    const all = byProviderClaims.get(p.id) ?? [];
    const surgical = all.filter((c) => isSurgical(c.procedure_codes, config));
    if (isScheduled(p) && all.some((c) => typeOf(c) === 'clean' && c.is_weekend)) fail(`${p.id} (${p.group}): clean weekend claim`);
    if (p.group === 'scheduled_heavy') {
      const cleanSurgical = surgical.filter((c) => typeOf(c) === 'clean').length;
      if (cleanSurgical < PARAMS.surgicalPerProvider.scheduled_heavy) fail(`${p.id}: ${cleanSurgical} clean surgical claims`);
      const injected = all.filter((c) => typeOf(c) === 'weekend_anomaly').length;
      if (injected > PARAMS.maxWeekendPerHospital) fail(`${p.id}: ${injected} weekend injections`);
    } else {
      const share = all.filter((c) => c.is_weekend).length / Math.max(all.length, 1);
      if (share < PARAMS.minWeekendShareOtherHospitals && surgical.length >= PARAMS.maxSurgicalOtherHospitals) {
        fail(`${p.id} (${p.group}): weekend share ${share.toFixed(3)} with ${surgical.length} surgical claims`);
      }
    }
  }
  for (const c of claims.filter((x) => typeOf(x) === 'weekend_anomaly')) {
    if (byProvider.get(c.provider_id)?.group !== 'scheduled_heavy' || !c.is_weekend) fail(`${c.claim_id}: weekend injection misplaced`);
  }

  // Upcoding statistics (Decisions 15, 16).
  const { z_threshold: zMax, min_other_claims: minOthers } = config.thresholds.upcoding;
  for (const [key, group] of groupBy(claims, (c) => comboKey(c.procedure_codes))) {
    const amounts = group.map((c) => c.submitted_amount);
    if (group.length > minOthers && (sampleStats(amounts)?.sd ?? 0) === 0) fail(`combination ${key}: SD = 0`);
    group.forEach((c, i) => {
      const type = typeOf(c);
      if (type !== 'amount_clustering' && type !== 'upcoding') return;
      const s = leaveOneOutStats(amounts, i, minOthers);
      if (!s || s.sd === 0) return fail(`${c.claim_id} (${type}): combination ${key} cannot be evaluated`);
      const z = (c.submitted_amount - s.mean) / s.sd;
      if (type === 'amount_clustering' && z > zMax) fail(`${c.claim_id}: clustering amount has z = ${z.toFixed(2)}`);
      if (type === 'upcoding' && z < PARAMS.upcoding.verifyMinZ) fail(`${c.claim_id}: upcoded amount has z = ${z.toFixed(2)}`);
    });
  }

  // Phantom day (Decision 5).
  const maxPerDay = config.thresholds.phantom_billing.max_claims_per_provider_day;
  for (const [key, group] of groupBy(claims, (c) => `${c.provider_id}|${c.claim_date}`)) {
    const isPhantomDay = key === `${phantom.providerId}|${phantom.date}`;
    if (isPhantomDay && group.length <= maxPerDay) fail(`phantom day ${key} has only ${group.length} claims`);
    if (!isPhantomDay && group.length > maxPerDay) fail(`provider-day ${key} has ${group.length} claims`);
  }

  // Duplicates: an identical clean claim with a smaller claim_id (Decision 1).
  const byDupKey = groupBy(claims, (c) => `${c.member_id}|${c.provider_id}|${c.claim_date}|${c.diagnosis_code}`);
  for (const c of claims.filter((x) => typeOf(x) === 'duplicate_claim')) {
    const group = byDupKey.get(`${c.member_id}|${c.provider_id}|${c.claim_date}|${c.diagnosis_code}`) ?? [];
    if (!group.some((o) => o.claim_id < c.claim_id && typeOf(o) === 'clean')) fail(`${c.claim_id}: no clean original with a smaller claim_id`);
  }

  // Rapid re-submissions: the preceding same member + diagnosis claim is 1–7 days earlier (Decision 2).
  const { min_gap_days: minGap, max_gap_days: maxGap } = config.thresholds.rapid_resubmission;
  const allByMemberDx = groupBy(claims, (c) => `${c.member_id}|${c.diagnosis_code}`);
  for (const c of claims.filter((x) => typeOf(x) === 'rapid_resubmission')) {
    const day = dayNumber(c.claim_date);
    const earlier = (allByMemberDx.get(`${c.member_id}|${c.diagnosis_code}`) ?? [])
      .map((o) => day - dayNumber(o.claim_date))
      .filter((gap) => gap > 0);
    const gap = Math.min(...earlier);
    if (!(gap >= minGap && gap <= maxGap)) fail(`${c.claim_id}: rapid copy is ${gap} days after the previous claim`);
  }

  // No unintended duplicate or rapid matches: only labeled claims may match those keys.
  for (const group of byDupKey.values()) {
    const sorted = [...group].sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));
    for (const c of sorted.slice(1)) if (typeOf(c) !== 'duplicate_claim') fail(`${c.claim_id}: unintended duplicate`);
  }
  for (const group of allByMemberDx.values()) {
    const sorted = [...group].sort((a, b) => dayNumber(a.claim_date) - dayNumber(b.claim_date));
    sorted.forEach((c, i) => {
      if (i === 0 || typeOf(c) === 'rapid_resubmission') return;
      const gap = dayNumber(c.claim_date) - dayNumber((sorted[i - 1] as Claim).claim_date);
      if (gap >= minGap && gap <= maxGap) fail(`${c.claim_id} (${typeOf(c)}): unintended rapid match, ${gap} days`);
    });
  }

  if (problems.length > 0) throw new Error(`Generated dataset failed verification:\n  - ${problems.join('\n  - ')}`);
}

export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = groups.get(k);
    if (list) list.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
