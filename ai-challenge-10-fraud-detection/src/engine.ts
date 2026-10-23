import { buildContext } from './context.js';
import { RULES } from './rules/index.js';
import type { Claim, Config, Flag } from './types.js';

export interface ClaimFlags {
  claim_id: string;
  /** Flags in RULE_NAMES order; empty when no rule fires. */
  flags: Flag[];
}

/** Runs every rule on every claim. The result has one entry per claim, in input order. */
export function runRules(claims: readonly Claim[], config: Config): ClaimFlags[] {
  const ctx = buildContext(claims, config);
  return claims.map((claim) => ({
    claim_id: claim.claim_id,
    flags: RULES.flatMap((rule) => {
      const flag = rule(claim, ctx);
      return flag ? [flag] : [];
    }),
  }));
}
