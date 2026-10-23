import type { RuleName } from '../types.js';

/** Generator parameters (see docs/DATA_DESIGN.md). Rule thresholds live in config/, not here. */
export const PARAMS = {
  year: 2024,
  memberCount: 500,
  /** Per-code lognormal noise: price × exp(sigma · Z). */
  amountNoiseSigma: 0.15,
  /** Same member + diagnosis must be at least this many days apart (Decision 18). */
  minSameDxGapDays: 8,

  clean: { total: 1800, dental: 270, outpatient: 1080 },
  /** Surgical clean claims per (diagnosis, protocol index); 450 in total (Decision 17). */
  surgicalSplit: [
    { dx: 'K35.80', protocol: 0, count: 90 },
    { dx: 'K35.80', protocol: 1, count: 90 },
    { dx: 'K80.20', protocol: 0, count: 135 },
    { dx: 'S52.50', protocol: 0, count: 135 },
  ],
  surgicalPerProvider: { scheduled_heavy: 30, scheduled_light: 10, hospital_24_7: 4 },
  outpatientClinicShare: 0.5,
  /** Non-heavy hospitals must stay below this many surgical claims (Decision 17). */
  maxSurgicalOtherHospitals: 20,
  minWeekendShareOtherHospitals: 0.08,

  fraudCounts: {
    phantom_billing: 25,
    weekend_anomaly: 20,
    duplicate_claim: 30,
    rapid_resubmission: 30,
    unbundling: 25,
    dx_procedure_mismatch: 20,
    upcoding: 30,
    amount_clustering: 20,
  } satisfies Record<RuleName, number>,

  phantomMovedClean: 6,
  maxWeekendPerHospital: 2,
  /**
   * A second upcoded claim in the same combination inflates the first one's
   * leave-one-out SD, so pairs only go to combinations with ≥ pairMinCleanClaims.
   */
  upcoding: { zMin: 3, zMax: 4.5, minCleanClaims: 20, pairMinCleanClaims: 85, verifyMinZ: 2.5 },
  clustering: { minUpperBound: 50_500, excludedCombos: ['B-9002+P-1007'] },

  maxAttempts: 2000,
} as const;
