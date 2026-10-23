import { isSurgical } from '../codes.js';
import { dayNumber } from '../dates.js';
import type { ClaimType, Config, IsoDate, RuleName } from '../types.js';
import { PARAMS } from './params.js';

/** A claim under construction: no claim_id yet, label kept alongside. */
export interface Draft {
  key: number;
  member_id: string;
  provider_id: string;
  claim_date: IsoDate;
  claim_type: ClaimType;
  diagnosis_code: string;
  procedure_codes: string[];
  submitted_amount: number;
  label: RuleName | null;
  /** For a duplicate copy: key of the clean claim it copies. */
  copyOf: number | null;
}

export type NewDraft = Omit<Draft, 'key' | 'copyOf'> & { copyOf?: number };

/** Generation state plus the indexes needed to keep injections from interfering. */
export class Ledger {
  readonly drafts: Draft[] = [];
  /** Clean claims already used as the base of an injection (or otherwise off-limits). */
  readonly usedAsBase = new Set<number>();
  /** provider|date pairs no other injection may add claims to (the phantom day). */
  readonly blockedProviderDays = new Set<string>();
  private readonly byMemberDx = new Map<string, Draft[]>();

  constructor(private readonly config: Config) {}

  add(input: NewDraft): Draft {
    const draft: Draft = { ...input, key: this.drafts.length, copyOf: input.copyOf ?? null };
    this.drafts.push(draft);
    const k = memberDxKey(draft.member_id, draft.diagnosis_code);
    const list = this.byMemberDx.get(k);
    if (list) list.push(draft);
    else this.byMemberDx.set(k, [draft]);
    return draft;
  }

  moveDate(draft: Draft, date: IsoDate): void {
    draft.claim_date = date;
  }

  /** Other claims with the same member + diagnosis. */
  sameMemberDx(member: string, dx: string): readonly Draft[] {
    return this.byMemberDx.get(memberDxKey(member, dx)) ?? [];
  }

  /**
   * True when no claim with the same member + diagnosis (other than `exceptKeys`)
   * is fewer than minSameDxGapDays days away from `date`, in either direction.
   */
  isFree(member: string, dx: string, date: IsoDate, exceptKeys: readonly number[] = []): boolean {
    const day = dayNumber(date);
    return this.sameMemberDx(member, dx).every(
      (d) => exceptKeys.includes(d.key) || Math.abs(dayNumber(d.claim_date) - day) >= PARAMS.minSameDxGapDays,
    );
  }

  isBlocked(providerId: string, date: IsoDate): boolean {
    return this.blockedProviderDays.has(`${providerId}|${date}`);
  }

  surgicalCount(providerId: string): number {
    return this.drafts.filter((d) => d.provider_id === providerId && isSurgical(d.procedure_codes, this.config)).length;
  }

  clean(): Draft[] {
    return this.drafts.filter((d) => d.label === null);
  }
}

function memberDxKey(member: string, dx: string): string {
  return `${member}|${dx}`;
}
