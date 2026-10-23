import { isSurgical } from '../codes.js';
import type { ClaimType, Config, IsoDate, RuleName } from '../types.js';
import type { Draft, Ledger } from './ledger.js';
import { PARAMS } from './params.js';
import type { Provider } from './providers.js';
import type { Rng } from './rng.js';

export interface GenContext {
  rng: Rng;
  config: Config;
  ledger: Ledger;
  providers: readonly Provider[];
  members: readonly string[];
}

/** What gets billed: a diagnosis, its procedure codes, and the claim type. */
export interface Slot {
  dx: string;
  codes: string[];
  claimType: ClaimType;
}

/** Every (diagnosis, protocol) pair from config, optionally filtered. */
export function protocolSlots(config: Config, filter: (slot: Slot) => boolean = () => true): Slot[] {
  return Object.entries(config.dxProtocols)
    .flatMap(([dx, entry]) => entry.protocols.map((codes) => ({ dx, codes: [...codes], claimType: entry.claim_type })))
    .filter(filter);
}

export function diagnosesOfType(config: Config, type: ClaimType): string[] {
  return Object.keys(config.dxProtocols).filter((dx) => config.dxProtocols[dx]?.claim_type === type);
}

export function protocolOf(config: Config, dx: string, index: number): Slot {
  const entry = config.dxProtocols[dx];
  const codes = entry?.protocols[index];
  if (!entry || !codes) throw new Error(`No protocol ${index} for diagnosis ${dx} in config`);
  return { dx, codes: [...codes], claimType: entry.claim_type };
}

/** Spread `total` over `n` buckets as evenly as possible. */
export function evenSplit(total: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
}

/** Round-robin `total` items over `buckets`, at most `maxEach` per bucket. */
export function roundRobin<T>(buckets: readonly T[], total: number, maxEach: number): T[] {
  if (buckets.length * maxEach < total) {
    throw new Error(`Cannot place ${total} items in ${buckets.length} buckets of at most ${maxEach}`);
  }
  return Array.from({ length: total }, (_, i) => buckets[i % buckets.length] as T);
}

/**
 * Providers that may receive a new claim for `slot`: they must bill the claim
 * type, and a non-heavy hospital must stay below the surgical limit (Decision 17).
 */
export function eligibleProviders(ctx: GenContext, slot: Slot, candidates: readonly Provider[]): Provider[] {
  const surgical = isSurgical(slot.codes, ctx.config);
  return candidates.filter(
    (p) =>
      p.claimTypes.includes(slot.claimType) &&
      !(surgical && p.group !== 'scheduled_heavy' && ctx.ledger.surgicalCount(p.id) >= PARAMS.maxSurgicalOtherHospitals - 1),
  );
}

export interface PlaceSpec {
  slot: Slot;
  label: RuleName | null;
  amount: number;
  providers: readonly Provider[];
  /** Candidate dates for a provider; defaults to its operating days. */
  dates?: (p: Provider) => readonly IsoDate[];
  memberOk?: (member: string) => boolean;
}

/**
 * Adds a new claim at a random provider, date and member such that it is not
 * on a blocked provider-day and is ≥ 8 days from every claim with the same
 * member + diagnosis (Decisions 13, 18).
 */
export function placeNew(ctx: GenContext, spec: PlaceSpec): Draft {
  const { rng, ledger } = ctx;
  const providers = eligibleProviders(ctx, spec.slot, spec.providers);
  if (providers.length === 0) throw new Error(`No eligible provider for ${spec.slot.dx} ${spec.slot.codes.join('|')}`);
  for (let attempt = 0; attempt < PARAMS.maxAttempts; attempt++) {
    const provider = rng.pick(providers);
    const date = rng.pick(spec.dates ? spec.dates(provider) : provider.operatingDates);
    const member = rng.pick(ctx.members);
    if (ledger.isBlocked(provider.id, date)) continue;
    if (spec.memberOk && !spec.memberOk(member)) continue;
    if (!ledger.isFree(member, spec.slot.dx, date)) continue;
    return ledger.add({
      member_id: member,
      provider_id: provider.id,
      claim_date: date,
      claim_type: spec.slot.claimType,
      diagnosis_code: spec.slot.dx,
      procedure_codes: [...spec.slot.codes],
      submitted_amount: spec.amount,
      label: spec.label,
    });
  }
  throw new Error(`Could not place a ${spec.label ?? 'clean'} claim for ${spec.slot.dx} after ${PARAMS.maxAttempts} attempts`);
}
