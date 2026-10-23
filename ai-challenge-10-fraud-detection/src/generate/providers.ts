import { datesInYear, dayOfWeekUtc } from '../dates.js';
import type { ClaimType, IsoDate } from '../types.js';
import { PARAMS } from './params.js';
import type { Rng } from './rng.js';

export type ProviderGroup = 'hospital_24_7' | 'scheduled_heavy' | 'scheduled_light' | 'general_clinic' | 'dental_clinic';

export interface Provider {
  id: string;
  name: string;
  group: ProviderGroup;
  claimTypes: readonly ClaimType[];
  operatingDates: readonly IsoDate[];
}

const GROUP_SIZES: readonly [ProviderGroup, number][] = [
  ['hospital_24_7', 15],
  ['scheduled_heavy', 12],
  ['scheduled_light', 3],
  ['general_clinic', 15],
  ['dental_clinic', 5],
];

const HOSPITAL_NAMES = [
  'Bangkok General Hospital', 'Chiang Mai Memorial Hospital', 'Phuket International Hospital',
  'Khon Kaen Hospital', 'Udon Thani General Hospital', 'Hat Yai Medical Center',
  'Nakhon Ratchasima Hospital', 'Pattaya City Hospital', 'Surat Thani Hospital',
  'Ubon Ratchathani General Hospital', 'Nonthaburi Hospital', 'Rayong Memorial Hospital',
  'Phitsanulok Hospital', 'Chonburi General Hospital', 'Lampang Hospital',
  'Hua Hin Hospital', 'Krabi General Hospital', 'Sukhothai Hospital',
  'Trang Hospital', 'Nan Provincial Hospital', 'Loei Hospital',
  'Yala Hospital', 'Saraburi Hospital', 'Ayutthaya Memorial Hospital',
  'Kanchanaburi Hospital', 'Chanthaburi Hospital', 'Phetchaburi Hospital',
  'Ratchaburi Hospital', 'Samut Prakan General Hospital', 'Pathum Thani Hospital',
];
const CLINIC_NAMES = [
  'Silom Medical Clinic', 'Sukhumvit Family Clinic', 'Sathorn Clinic, Branch 2',
  'Ari Medical Clinic', 'Thonglor Clinic', 'Ladprao Polyclinic',
  'Bang Na Medical Clinic', 'Ratchada Clinic', 'Nimman Clinic, Chiang Mai',
  'Patong Medical Clinic', 'Old Town Clinic', 'Riverside Polyclinic',
  'Lakeside Clinic', 'Central Medical Clinic', 'Northgate Clinic',
];
const DENTAL_NAMES = [
  'Smile Dental Clinic', 'Bright Teeth Dental', 'Pearl Dental, Co. Ltd',
  'Gentle Dental Care', 'Family Dental Clinic',
];

const WEEKDAYS = new Set([1, 2, 3, 4, 5]);
const MON_TO_SAT = new Set([1, 2, 3, 4, 5, 6]);

/** 50 providers; groups are shuffled over the IDs so an ID does not reveal the group. */
export function buildProviders(rng: Rng): Provider[] {
  const all = datesInYear(PARAMS.year);
  const onDays = (days: ReadonlySet<number>): IsoDate[] => all.filter((d) => days.has(dayOfWeekUtc(d)));
  const weekdays = onDays(WEEKDAYS);
  const monToSat = onDays(MON_TO_SAT);

  const groups = rng.shuffle(GROUP_SIZES.flatMap(([group, n]) => Array<ProviderGroup>(n).fill(group)));
  const names = { hospital: [...HOSPITAL_NAMES], clinic: [...CLINIC_NAMES], dental: [...DENTAL_NAMES] };
  const take = (list: string[]): string => {
    const name = list.shift();
    if (name === undefined) throw new Error('Ran out of provider names');
    return name;
  };

  return groups.map((group, i) => {
    const id = `PRV-${String(i + 1).padStart(2, '0')}`;
    switch (group) {
      case 'hospital_24_7':
        return { id, group, name: take(names.hospital), claimTypes: ['OUTPATIENT', 'INPATIENT'], operatingDates: all };
      case 'scheduled_heavy':
      case 'scheduled_light':
        return { id, group, name: take(names.hospital), claimTypes: ['OUTPATIENT', 'INPATIENT'], operatingDates: weekdays };
      case 'general_clinic':
        return { id, group, name: take(names.clinic), claimTypes: ['OUTPATIENT'], operatingDates: weekdays };
      case 'dental_clinic':
        return { id, group, name: take(names.dental), claimTypes: ['DENTAL'], operatingDates: monToSat };
    }
  });
}

export function isHospital(p: Provider): boolean {
  return p.group === 'hospital_24_7' || p.group === 'scheduled_heavy' || p.group === 'scheduled_light';
}

export function isScheduled(p: Provider): boolean {
  return p.group === 'scheduled_heavy' || p.group === 'scheduled_light';
}
