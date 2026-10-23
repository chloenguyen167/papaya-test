import { describeCode, referencePrice } from '../codes.js';
import { formatNumber } from '../format.js';
import type { Claim, Flag, RuleContext } from '../types.js';

/**
 * Flags a claim carrying ALL components of a configured bundle (Decision 4).
 * The bundle code may be absent (split billing) or present as well (the same
 * services are billed twice). One flag lists every bundle that matches.
 */
export function unbundling(claim: Claim, ctx: RuleContext): Flag | null {
  const { config } = ctx;
  const codes = new Set(claim.procedure_codes);
  const findings: string[] = [];

  for (const [bundleCode, bundle] of Object.entries(config.bundles)) {
    if (!bundle.components.every((component) => codes.has(component))) continue;

    const components = bundle.components.join(', ');
    const itemized = bundle.components.reduce((sum, component) => sum + referencePrice(component, config), 0);
    const prices = `bundle price ${formatNumber(bundle.price)} vs itemized total ${formatNumber(itemized)}`;
    const label = describeCode(bundleCode, config);

    findings.push(
      codes.has(bundleCode)
        ? `bundle ${label} is billed together with all its components ${components}, so the same services are billed twice (${prices})`
        : `components ${components} are billed separately; bundle ${label} should be used (${prices})`,
    );
  }

  if (findings.length === 0) return null;
  return {
    rule: 'unbundling',
    severity: config.weights.unbundling,
    evidence: `Unbundling: ${findings.join('; ')}`,
  };
}
