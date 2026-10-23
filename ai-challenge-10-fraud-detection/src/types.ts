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
  is_fraud: boolean;
  /** Patterns injected into this claim; empty for clean claims. */
  fraud_types: RuleName[];
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
  upcoding: { z_threshold: number; min_group_size: number };
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

/**
 * Dataset-wide view handed to every rule. Rules must be pure functions of
 * (claim, context) and must not receive fraud labels.
 */
export interface RuleContext {
  claims: readonly Claim[];
  config: Config;
}
