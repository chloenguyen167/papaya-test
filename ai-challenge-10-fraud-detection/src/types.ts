/** Calendar date as 'YYYY-MM-DD'. Day of week is always computed in UTC. */
export type IsoDate = string;

export const CLAIM_TYPES = ['OUTPATIENT', 'INPATIENT', 'DENTAL'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export interface Claim {
  claim_id: string;
  member_id: string;
  provider_id: string;
  provider_name: string;
  claim_date: IsoDate;
  claim_type: ClaimType;
  diagnosis_code: string;
  procedure_codes: string[];
  submitted_amount: number;
  is_weekend: boolean;
}

export const RULE_NAMES = [
  'duplicate_claim',
  'rapid_resubmission',
  'upcoding',
  'unbundling',
  'phantom_billing',
  'weekend_anomaly',
  'dx_procedure_mismatch',
  'amount_clustering',
] as const;
export type RuleName = (typeof RULE_NAMES)[number];

/** Ground truth for one claim. Stored separately from claims; rules never read it. */
export interface FraudLabel {
  claim_id: string;
  /** The single pattern injected into this claim, or 'clean'. */
  fraud_type: RuleName | 'clean';
}

export interface Flag {
  rule: RuleName;
  severity: number;
  evidence: string;
}

export interface ScoredClaim {
  claim_id: string;
  risk_score: number;
  flags: Flag[];
}

export type ProcedureCategory = 'medical' | 'surgical' | 'dental';

export interface Procedure {
  name: string;
  category: ProcedureCategory;
  reference_price: number;
}

export interface Bundle {
  name: string;
  components: string[];
  price: number;
}

export interface DiagnosisProtocols {
  claim_type: ClaimType;
  /** Fixed procedure lists that clean claims for this diagnosis are drawn from. */
  protocols: string[][];
}

export interface Thresholds {
  rapid_resubmission: { min_gap_days: number; max_gap_days: number };
  /** min_other_claims counts the group's claims excluding the claim being evaluated (Decision 15). */
  upcoding: { z_threshold: number; min_other_claims: number };
  phantom_billing: { max_claims_per_provider_day: number };
  weekend_anomaly: { max_weekend_share: number; min_provider_claims: number };
  amount_clustering: { auto_approval_threshold: number; min_amount: number; max_amount: number };
}

export interface Config {
  procedures: Record<string, Procedure>;
  bundles: Record<string, Bundle>;
  dxProtocols: Record<string, DiagnosisProtocols>;
  /** Derived: union of a diagnosis's protocol codes plus the components of any bundle in them. */
  validProceduresByDx: Record<string, string[]>;
  weights: Record<RuleName, number>;
  thresholds: Thresholds;
}

/** Count, sum and sum of squares of the amounts billed under one procedure-code combination. */
export interface AmountAggregate {
  n: number;
  sum: number;
  sumSquares: number;
}

/** Number of claims and how many of them fall on a weekend, over some set of one provider's claims. */
export interface WeekendTally {
  claims: number;
  weekendClaims: number;
}

/**
 * Dataset-wide view handed to every rule, built once by `buildContext`.
 * Rules must be pure functions of (claim, context) and must not receive fraud
 * labels. Keys are made by the `*Key` functions in `context.ts`.
 */
export interface RuleContext {
  claims: readonly Claim[];
  config: Config;
  /** member + provider + date + diagnosis → claims, ascending by claim_id (duplicate). */
  duplicateGroups: ReadonlyMap<string, readonly Claim[]>;
  /** member + diagnosis → claims, ascending by date then claim_id (rapid re-submission). */
  memberDiagnosisHistory: ReadonlyMap<string, readonly Claim[]>;
  /** provider + date → claims (phantom billing). */
  providerDayClaims: ReadonlyMap<string, readonly Claim[]>;
  /** provider → number of distinct dates with at least one claim (phantom billing). */
  providerActiveDays: ReadonlyMap<string, number>;
  /** procedure-code combination → amount aggregate (upcoding). */
  comboAmounts: ReadonlyMap<string, AmountAggregate>;
  /** provider → claim and weekend-claim counts (weekend anomaly). */
  providerWeekend: ReadonlyMap<string, WeekendTally>;
  /** provider → surgical-claim and weekend-surgical-claim counts (weekend anomaly, Decision 19). */
  providerSurgical: ReadonlyMap<string, WeekendTally>;
}
