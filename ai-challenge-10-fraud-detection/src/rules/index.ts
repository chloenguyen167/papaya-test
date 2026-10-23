import { RULE_NAMES, type Rule, type RuleName } from '../types.js';
import { amountClustering } from './amount-clustering.js';
import { duplicateClaim } from './duplicate-claim.js';
import { dxProcedureMismatch } from './dx-procedure-mismatch.js';
import { phantomBilling } from './phantom-billing.js';
import { rapidResubmission } from './rapid-resubmission.js';
import { unbundling } from './unbundling.js';
import { upcoding } from './upcoding.js';
import { weekendAnomaly } from './weekend-anomaly.js';

/** Keyed by rule name, so the compiler rejects a missing or extra rule. */
const RULES_BY_NAME: Record<RuleName, Rule> = {
  duplicate_claim: duplicateClaim,
  rapid_resubmission: rapidResubmission,
  upcoding,
  unbundling,
  phantom_billing: phantomBilling,
  weekend_anomaly: weekendAnomaly,
  dx_procedure_mismatch: dxProcedureMismatch,
  amount_clustering: amountClustering,
};

/** All 8 rules, in RULE_NAMES order. */
export const RULES: readonly Rule[] = RULE_NAMES.map((name) => RULES_BY_NAME[name]);
