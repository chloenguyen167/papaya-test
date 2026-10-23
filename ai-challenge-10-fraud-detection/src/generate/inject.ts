import { comboKey, isSurgical } from '../codes.js';
import { addDays, datesInYear, isWeekend } from '../dates.js';
import { sampleStats } from '../stats.js';
import type { ClaimType, IsoDate } from '../types.js';
import { inClusteringBand, roundTo10, sampleAmount } from './amounts.js';
import {
  diagnosesOfType,
  eligibleProviders,
  placeNew,
  protocolSlots,
  roundRobin,
  type GenContext,
  type Slot,
} from './context.js';
import type { Draft } from './ledger.js';
import { PARAMS } from './params.js';
import type { Provider } from './providers.js';

/** Clean statistics of one procedure-code combination. */
export interface ComboStats {
  key: string;
  slots: Slot[];
  count: number;
  mean: number;
  sd: number;
}

/** Mean and sample SD per combination, over clean claims only. */
export function cleanComboStats(ctx: GenContext): ComboStats[] {
  const groups = new Map<string, { slots: Map<string, Slot>; amounts: number[] }>();
  for (const d of ctx.ledger.clean()) {
    const key = comboKey(d.procedure_codes);
    const group = groups.get(key) ?? { slots: new Map<string, Slot>(), amounts: [] };
    group.slots.set(d.diagnosis_code, { dx: d.diagnosis_code, codes: [...d.procedure_codes], claimType: d.claim_type });
    group.amounts.push(d.submitted_amount);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, g]) => {
      const stats = sampleStats(g.amounts);
      return { key, slots: [...g.slots.values()], count: g.amounts.length, mean: stats?.mean ?? 0, sd: stats?.sd ?? 0 };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Combinations that may carry clustering claims (Decision 16). */
export function clusteringBases(stats: readonly ComboStats[]): ComboStats[] {
  const excluded: readonly string[] = PARAMS.clustering.excludedCombos;
  const bases = stats.filter(
    (s) => !excluded.includes(s.key) && s.count >= 2 && s.mean + 2 * s.sd >= PARAMS.clustering.minUpperBound,
  );
  if (bases.length === 0) {
    throw new Error(`No combination has clean mean + 2 SD >= ${PARAMS.clustering.minUpperBound}; clustering cannot be injected`);
  }
  return bases;
}

const providersFor = (ctx: GenContext, type: ClaimType): Provider[] =>
  ctx.providers.filter((p) => p.claimTypes.includes(type));

function surgicalSlots(ctx: GenContext): Slot[] {
  return protocolSlots(ctx.config, (s) => isSurgical(s.codes, ctx.config));
}

/** Clean claims that may still serve as the base of an injection. */
function availableBases(ctx: GenContext): Draft[] {
  return ctx.ledger.clean().filter((d) => !ctx.ledger.usedAsBase.has(d.key));
}

export interface PhantomInfo {
  providerId: string;
  date: IsoDate;
}

/**
 * 1. Phantom billing: 25 fake claims plus 6 moved clean claims on one clinic-day.
 * Moved claims keep the member + diagnosis spacing at their new date.
 */
export function injectPhantom(ctx: GenContext): PhantomInfo {
  const { rng, ledger, config } = ctx;
  const clinics = ctx.providers.filter((p) => p.group === 'general_clinic');
  const outpatientSlots = protocolSlots(config, (s) => s.claimType === 'OUTPATIENT');

  for (let attempt = 0; attempt < PARAMS.maxAttempts; attempt++) {
    const clinic = rng.pick(clinics);
    const day = rng.pick(clinic.operatingDates);
    const onDay = () => ledger.drafts.filter((d) => d.provider_id === clinic.id && d.claim_date === day);
    const members = new Set(onDay().map((d) => d.member_id));

    const toMove: Draft[] = [];
    for (const c of rng.shuffle(ledger.clean().filter((d) => d.provider_id === clinic.id && d.claim_date !== day))) {
      if (toMove.length === PARAMS.phantomMovedClean) break;
      if (members.has(c.member_id) || !ledger.isFree(c.member_id, c.diagnosis_code, day, [c.key])) continue;
      toMove.push(c);
      members.add(c.member_id);
    }
    if (toMove.length < PARAMS.phantomMovedClean) continue;
    for (const c of toMove) ledger.moveDate(c, day);

    for (let i = 0; i < PARAMS.fraudCounts.phantom_billing; i++) {
      const slot = rng.pick(outpatientSlots);
      const draft = placeNew(ctx, {
        slot,
        label: 'phantom_billing',
        amount: sampleAmount(rng, slot.codes, config),
        providers: [clinic],
        dates: () => [day],
        memberOk: (m) => !members.has(m),
      });
      members.add(draft.member_id);
    }
    for (const d of onDay()) ledger.usedAsBase.add(d.key);
    ledger.blockedProviderDays.add(`${clinic.id}|${day}`);
    return { providerId: clinic.id, date: day };
  }
  throw new Error('Could not find a clinic-day for phantom billing');
}

/** 2. Weekend anomaly: surgery on Sat/Sun at heavy scheduled hospitals, at most 2 each (Decision 14). */
export function injectWeekend(ctx: GenContext): void {
  const { rng, config } = ctx;
  const heavy = rng.shuffle(ctx.providers.filter((p) => p.group === 'scheduled_heavy'));
  const weekends = datesInYear(PARAMS.year).filter(isWeekend);
  const slots = surgicalSlots(ctx);
  for (const hospital of roundRobin(heavy, PARAMS.fraudCounts.weekend_anomaly, PARAMS.maxWeekendPerHospital)) {
    const slot = rng.pick(slots);
    placeNew(ctx, {
      slot,
      label: 'weekend_anomaly',
      amount: sampleAmount(rng, slot.codes, config),
      providers: [hospital],
      dates: () => weekends,
    });
  }
}

/** 3. Duplicate: exact copy of a clean claim; each base is used once. */
export function injectDuplicates(ctx: GenContext): void {
  const { rng, ledger } = ctx;
  const byId = new Map(ctx.providers.map((p) => [p.id, p]));
  let placed = 0;
  for (const base of rng.shuffle(availableBases(ctx))) {
    if (placed === PARAMS.fraudCounts.duplicate_claim) break;
    const provider = byId.get(base.provider_id);
    if (!provider || eligibleProviders(ctx, slotOf(base), [provider]).length === 0) continue;
    ledger.add({ ...copyFields(base), label: 'duplicate_claim', copyOf: base.key });
    ledger.usedAsBase.add(base.key);
    placed++;
  }
  if (placed < PARAMS.fraudCounts.duplicate_claim) throw new Error(`Only ${placed} duplicate bases available`);
}

/**
 * 4. Rapid re-submission: copy of a non-surgical clean claim at +1..7 days on a
 * weekday in the same year. The copy must be ≥ 8 days from every other claim
 * with the same member + diagnosis except its original (Decision 13).
 */
export function injectRapid(ctx: GenContext): void {
  const { rng, ledger, config } = ctx;
  const byId = new Map(ctx.providers.map((p) => [p.id, p]));
  let placed = 0;
  for (const base of rng.shuffle(availableBases(ctx).filter((d) => !isSurgical(d.procedure_codes, config)))) {
    if (placed === PARAMS.fraudCounts.rapid_resubmission) break;
    const provider = byId.get(base.provider_id);
    if (!provider) continue;
    const offsets = rng.shuffle([1, 2, 3, 4, 5, 6, 7]);
    for (const k of offsets) {
      const date = addDays(base.claim_date, k);
      if (!date.startsWith(`${PARAMS.year}-`) || isWeekend(date)) continue;
      if (!provider.operatingDates.includes(date) || ledger.isBlocked(provider.id, date)) continue;
      if (!ledger.isFree(base.member_id, base.diagnosis_code, date, [base.key])) continue;
      ledger.add({
        ...copyFields(base),
        claim_date: date,
        submitted_amount: sampleAmount(rng, base.procedure_codes, config),
        label: 'rapid_resubmission',
      });
      ledger.usedAsBase.add(base.key);
      placed++;
      break;
    }
  }
  if (placed < PARAMS.fraudCounts.rapid_resubmission) throw new Error(`Only ${placed} rapid re-submission bases available`);
}

/** 5. Unbundling: a protocol with a bundle code, the bundle replaced by all of its components. */
export function injectUnbundling(ctx: GenContext): void {
  const { rng, config } = ctx;
  const withBundle = rng.shuffle(protocolSlots(config, (s) => s.codes.some((c) => config.bundles[c] !== undefined)));
  for (const slot of roundRobin(withBundle, PARAMS.fraudCounts.unbundling, Number.POSITIVE_INFINITY)) {
    const codes = [...new Set(slot.codes.flatMap((c) => config.bundles[c]?.components ?? [c]))];
    const unbundled: Slot = { ...slot, codes };
    placeNew(ctx, {
      slot: unbundled,
      label: 'unbundling',
      amount: sampleAmount(rng, codes, config),
      providers: providersFor(ctx, slot.claimType),
    });
  }
}

/**
 * 6. Dx–procedure mismatch: a mapped diagnosis with the full protocol of a
 * diagnosis from another group (outpatient / inpatient surgical / dental).
 */
export function injectMismatch(ctx: GenContext): void {
  const { rng, config } = ctx;
  const types: ClaimType[] = ['OUTPATIENT', 'INPATIENT', 'DENTAL'];
  let placed = 0;
  for (let attempt = 0; placed < PARAMS.fraudCounts.dx_procedure_mismatch; attempt++) {
    if (attempt >= PARAMS.maxAttempts) throw new Error('Could not build dx–procedure mismatch claims');
    const targetType = rng.pick(types);
    const dx = rng.pick(diagnosesOfType(config, targetType));
    const sourceType = rng.pick(types.filter((t) => t !== targetType));
    const source = rng.pick(protocolSlots(config, (s) => s.claimType === sourceType));
    const valid = config.validProceduresByDx[dx] ?? [];
    if (source.codes.every((c) => valid.includes(c))) continue;
    const slot: Slot = { dx, codes: source.codes, claimType: source.claimType };
    placeNew(ctx, {
      slot,
      label: 'dx_procedure_mismatch',
      amount: sampleAmount(rng, slot.codes, config),
      providers: providersFor(ctx, slot.claimType),
    });
    placed++;
  }
}

/**
 * 7. Upcoding: clean mean + z × clean SD, z in [3, 4.5]. One claim per
 * combination first; a second only in large combinations, to limit masking.
 */
export function injectUpcoding(ctx: GenContext, stats: readonly ComboStats[]): void {
  const { rng, config } = ctx;
  const { minCleanClaims, pairMinCleanClaims } = PARAMS.upcoding;
  const singles = rng.shuffle(stats.filter((s) => s.count >= minCleanClaims));
  const pairs = singles.filter((s) => s.count >= pairMinCleanClaims);
  const targets = [...singles, ...pairs].slice(0, PARAMS.fraudCounts.upcoding);
  if (targets.length < PARAMS.fraudCounts.upcoding) {
    throw new Error(`Only ${targets.length} upcoding slots (${singles.length} combinations, ${pairs.length} large enough for a pair)`);
  }
  for (const combo of targets) {
    const slot = rng.pick(combo.slots);
    let amount = Number.NaN;
    for (let attempt = 0; attempt < PARAMS.maxAttempts; attempt++) {
      amount = roundTo10(combo.mean + rng.uniform(PARAMS.upcoding.zMin, PARAMS.upcoding.zMax) * combo.sd);
      if (!inClusteringBand(amount, config)) break;
    }
    if (inClusteringBand(amount, config)) throw new Error(`Upcoded amount for ${combo.key} stays in the clustering band`);
    placeNew(ctx, { slot, label: 'upcoding', amount, providers: providersFor(ctx, slot.claimType) });
  }
}

/** 8. Amount clustering: amount drawn from the band, only on clustering-base combinations. */
export function injectClustering(ctx: GenContext, bases: readonly ComboStats[]): void {
  const { rng, config } = ctx;
  const band = config.thresholds.amount_clustering;
  const lo = Math.ceil(band.min_amount / 10);
  const hi = Math.floor(band.max_amount / 10);
  for (const combo of roundRobin(rng.shuffle([...bases]), PARAMS.fraudCounts.amount_clustering, Number.POSITIVE_INFINITY)) {
    const slot = rng.pick(combo.slots);
    placeNew(ctx, {
      slot,
      label: 'amount_clustering',
      amount: rng.int(lo, hi) * 10,
      providers: providersFor(ctx, slot.claimType),
    });
  }
}

function slotOf(d: Draft): Slot {
  return { dx: d.diagnosis_code, codes: d.procedure_codes, claimType: d.claim_type };
}

function copyFields(d: Draft) {
  return {
    member_id: d.member_id,
    provider_id: d.provider_id,
    claim_date: d.claim_date,
    claim_type: d.claim_type,
    diagnosis_code: d.diagnosis_code,
    procedure_codes: [...d.procedure_codes],
    submitted_amount: d.submitted_amount,
  };
}
