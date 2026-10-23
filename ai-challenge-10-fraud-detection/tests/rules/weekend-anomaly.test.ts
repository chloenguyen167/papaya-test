import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { buildContext } from '../../src/context.js';
import { weekendAnomaly } from '../../src/rules/weekend-anomaly.js';
import type { Claim } from '../../src/types.js';
import { makeClaim } from '../helpers.js';

const config = loadConfig(join(import.meta.dirname, '..', '..', 'config'));

const WEEKDAYS = ['2024-03-04', '2024-03-05', '2024-03-06', '2024-03-07', '2024-03-08']; // Monday–Friday
const SATURDAY = '2024-03-16';
const SUNDAY = '2024-03-17';
const NEXT_SUNDAY = '2024-03-24';

/** Appendectomy + anesthesia, both surgical, on a Sunday at PRV-01. */
function surgery(overrides: Partial<Claim> = {}): Claim {
  return makeClaim({
    diagnosis_code: 'K35.80',
    claim_type: 'INPATIENT',
    procedure_codes: ['P-2001', 'P-2002'],
    submitted_amount: 38_000,
    claim_date: SUNDAY,
    ...overrides,
  });
}

/** `count` surgical claims on weekdays at one provider. */
function weekdayClaims(count: number, provider_id = 'PRV-01'): Claim[] {
  return Array.from({ length: count }, (_, i) =>
    surgery({ provider_id, member_id: `M-${i}`, claim_date: WEEKDAYS[i % WEEKDAYS.length] as string }),
  );
}

/** `count` routine (non-surgical) consultations at one provider on the given dates, cycling. */
function consultations(count: number, dates: readonly string[], provider_id = 'PRV-01'): Claim[] {
  return Array.from({ length: count }, (_, i) =>
    makeClaim({ provider_id, member_id: `C-${provider_id}-${i}`, claim_date: dates[i % dates.length] as string }),
  );
}

function evaluate(claim: Claim, others: Claim[]) {
  return weekendAnomaly(claim, buildContext([...others, claim], config));
}

describe('weekendAnomaly', () => {
  it('flags both Sunday surgeries at a provider with 40 surgical claims and no other weekend surgery (1/39 ≈ 2.6%)', () => {
    const first = surgery({ claim_date: SUNDAY });
    const second = surgery({ claim_date: NEXT_SUNDAY });
    const ctx = buildContext([...weekdayClaims(38), first, second], config);

    for (const claim of [first, second]) {
      const flag = weekendAnomaly(claim, ctx);
      expect(flag?.rule).toBe('weekend_anomaly');
      expect(flag?.severity).toBe(config.weights.weekend_anomaly);
      expect(flag?.evidence).toContain('1/39');
      expect(flag?.evidence).toContain('2.6%');
    }
  });

  it('excludes the evaluated claim from the share, otherwise injected cases hide each other (Decision 6)', () => {
    // Counting the claim itself gives 2/40 = 5.0%, which is NOT below the 5% limit:
    // each of the two Sunday surgeries would lift the share enough to clear the other,
    // and the rule would miss exactly the cases it exists to catch. Excluding the
    // evaluated claim leaves 1 weekend claim among 39 others = 2.6%, so both are caught.
    const { max_weekend_share } = config.thresholds.weekend_anomaly;
    expect(2 / 40 < max_weekend_share).toBe(false);
    expect(1 / 39 < max_weekend_share).toBe(true);

    const first = surgery({ claim_date: SUNDAY });
    const second = surgery({ claim_date: NEXT_SUNDAY });
    const ctx = buildContext([...weekdayClaims(38), first, second], config);
    const evidence = weekendAnomaly(first, ctx)?.evidence ?? '';

    expect(evidence).toContain('1/39');
    expect(evidence).not.toContain('2/40');
    expect(evidence).toContain('excluding this claim');
  });

  it('does not flag Sunday surgery at a 24/7 hospital with ~28% weekend surgical claims', () => {
    // 36 weekday + 13 weekend surgeries + this Sunday surgery = 14/50 = 28% weekend;
    // without this claim 13/49 ≈ 26.5%, far above 5%.
    const weekend = Array.from({ length: 13 }, (_, i) => surgery({ member_id: `W-${i}`, claim_date: i % 2 ? SATURDAY : NEXT_SUNDAY }));
    expect(evaluate(surgery(), [...weekdayClaims(36), ...weekend])).toBeNull();
  });

  it('does not flag a routine (non-surgical) consultation on a Saturday', () => {
    const history = weekdayClaims(39);
    expect(evaluate(makeClaim({ claim_date: SATURDAY }), history)).toBeNull();
    // Same provider, same day, but surgical: flagged. Only the procedure differs.
    expect(evaluate(surgery({ claim_date: SATURDAY }), history)).not.toBeNull();
  });

  it('does not flag weekday surgery', () => {
    expect(evaluate(surgery({ claim_date: '2024-03-18' }), weekdayClaims(39))).toBeNull();
  });

  it('does not flag a provider with only 15 surgical claims (below the history minimum of 20)', () => {
    expect(evaluate(surgery(), weekdayClaims(14))).toBeNull();
  });

  it('counts min_provider_claims over the provider’s surgical claims: 20 is evaluated, 19 is not', () => {
    // Decision 19: a provider with 20 surgical claims, this one included, is evaluated
    // against the 19 others.
    expect(evaluate(surgery(), weekdayClaims(19))?.evidence).toContain('0/19');
    expect(evaluate(surgery(), weekdayClaims(18))).toBeNull();
  });

  it('treats the bundle B-9002 (appendectomy package) on a Sunday as surgery (Decision 14)', () => {
    const claim = surgery({ procedure_codes: ['P-1008', 'B-9002'] });
    const evidence = evaluate(claim, weekdayClaims(39))?.evidence ?? '';
    expect(evidence).toContain('B-9002');
    expect(evidence).toContain('P-2001');
  });

  it('uses surgical claims only as the denominator: 100 weekday consultations do not make up for 5 surgeries', () => {
    // 5 surgeries are below the 20-claim minimum, however many routine claims the provider has.
    const history = [...weekdayClaims(4), ...consultations(100, WEEKDAYS)];
    expect(evaluate(surgery(), history)).toBeNull();
  });

  it('does not let weekend consultations mask weekend surgery (Decision 19)', () => {
    // 39 weekday surgeries plus 40 Saturday/Sunday consultations: the all-claims share of the
    // other 79 claims would be 40/79 ≈ 51%, but none of the 39 other surgical claims is on a weekend.
    const history = [...weekdayClaims(39), ...consultations(40, [SATURDAY, NEXT_SUNDAY])];
    const evidence = evaluate(surgery(), history)?.evidence ?? '';
    expect(evidence).toContain('0/39');
  });

  it('does not count other providers’ weekend claims in the share', () => {
    const elsewhere = Array.from({ length: 30 }, (_, i) => surgery({ provider_id: 'PRV-02', member_id: `X-${i}`, claim_date: SATURDAY }));
    expect(evaluate(surgery(), [...weekdayClaims(39), ...elsewhere])).not.toBeNull();
  });

  it('puts the surgical codes, weekday and date, provider, share as % and x/y, and the exclusion in the evidence', () => {
    const evidence = evaluate(surgery(), weekdayClaims(39))?.evidence ?? '';
    for (const part of ['P-2001 (Appendectomy)', 'P-2002 (Anesthesia)', `Sunday ${SUNDAY}`, 'PRV-01', '0.0%', '0/39 surgical claims', 'excluding this claim', '5%']) {
      expect(evidence).toContain(part);
    }
  });
});

describe('weekendAnomaly day of week is computed in UTC', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it('really switches the local time zone, so a local-time implementation would fail here', () => {
    process.env.TZ = 'Pacific/Pago_Pago'; // UTC−11: UTC midnight of 2024-03-16 is Friday locally
    expect(new Date('2024-03-16').getDay()).toBe(5);
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: local midnight of 2024-03-16 is Friday in UTC
    expect(new Date(2024, 2, 16).getUTCDay()).toBe(5);
  });

  it.each(['UTC', 'Asia/Ho_Chi_Minh', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    'treats 2024-03-16 as Saturday and 2024-03-18 as Monday with TZ=%s',
    (tz) => {
      process.env.TZ = tz;
      const history = weekdayClaims(39);
      expect(evaluate(surgery({ claim_date: '2024-03-16' }), history)?.evidence).toContain('Saturday 2024-03-16');
      expect(evaluate(surgery({ claim_date: '2024-03-18' }), history)).toBeNull();
    },
  );
});
