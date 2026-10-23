import { isWeekend } from '../src/dates.js';
import type { Claim } from '../src/types.js';

let nextId = 1;

/**
 * A clean, valid claim: J06.9 with P-1001, on a weekday (Wednesday 2024-03-06),
 * amount 800. Each call gets a fresh claim_id unless `overrides` sets one.
 * `is_weekend` follows `claim_date` unless `overrides` sets it explicitly.
 */
export function makeClaim(overrides: Partial<Claim> = {}): Claim {
  const claim_date = overrides.claim_date ?? '2024-03-06';
  return {
    claim_id: `CLM-T${String(nextId++).padStart(5, '0')}`,
    member_id: 'M-0001',
    provider_id: 'PRV-01',
    provider_name: 'Test Clinic',
    claim_date,
    claim_type: 'OUTPATIENT',
    diagnosis_code: 'J06.9',
    procedure_codes: ['P-1001'],
    submitted_amount: 800,
    is_weekend: isWeekend(claim_date),
    ...overrides,
  };
}
