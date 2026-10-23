import { sampleAmount } from './amounts.js';
import { diagnosesOfType, evenSplit, placeNew, protocolOf, type GenContext, type Slot } from './context.js';
import { PARAMS } from './params.js';
import { isHospital, type Provider, type ProviderGroup } from './providers.js';

/** Generates the 1,800 clean claims (DATA_DESIGN.md §D). */
export function generateClean(ctx: GenContext): void {
  const { rng, config, providers } = ctx;
  const inGroup = (g: ProviderGroup): Provider[] => providers.filter((p) => p.group === g);
  const assignments: { slot: Slot; provider: Provider }[] = [];

  // Surgical: fixed per-provider allocation (Decision 17).
  const surgicalSlots = rng.shuffle(
    PARAMS.surgicalSplit.flatMap((s) => Array.from({ length: s.count }, () => protocolOf(config, s.dx, s.protocol))),
  );
  const surgicalProviders = rng.shuffle(
    (Object.entries(PARAMS.surgicalPerProvider) as [ProviderGroup, number][]).flatMap(([group, n]) =>
      inGroup(group).flatMap((p) => Array<Provider>(n).fill(p)),
    ),
  );
  if (surgicalSlots.length !== surgicalProviders.length) {
    throw new Error(`Surgical split (${surgicalSlots.length}) does not match provider allocation (${surgicalProviders.length})`);
  }
  surgicalSlots.forEach((slot, i) => assignments.push({ slot, provider: surgicalProviders[i] as Provider }));

  // Dental: even per diagnosis, any dental clinic.
  const dentalDx = diagnosesOfType(config, 'DENTAL');
  const dentalClinics = inGroup('dental_clinic');
  evenSplit(PARAMS.clean.dental, dentalDx.length).forEach((count, i) => {
    const dx = dentalDx[i] as string;
    for (let n = 0; n < count; n++) {
      const protocols = config.dxProtocols[dx]?.protocols ?? [];
      assignments.push({ slot: protocolOf(config, dx, rng.int(0, protocols.length - 1)), provider: rng.pick(dentalClinics) });
    }
  });

  // Outpatient: even per diagnosis; about half at general clinics, the rest at hospitals.
  const outpatientDx = diagnosesOfType(config, 'OUTPATIENT');
  const outpatientSlots: Slot[] = [];
  evenSplit(PARAMS.clean.outpatient, outpatientDx.length).forEach((count, i) => {
    const dx = outpatientDx[i] as string;
    for (let n = 0; n < count; n++) {
      const protocols = config.dxProtocols[dx]?.protocols ?? [];
      outpatientSlots.push(protocolOf(config, dx, rng.int(0, protocols.length - 1)));
    }
  });
  rng.shuffle(outpatientSlots);
  const clinics = inGroup('general_clinic');
  const hospitals = providers.filter(isHospital);
  const clinicCount = Math.round(outpatientSlots.length * PARAMS.outpatientClinicShare);
  outpatientSlots.forEach((slot, i) =>
    assignments.push({ slot, provider: rng.pick(i < clinicCount ? clinics : hospitals) }),
  );

  if (assignments.length !== PARAMS.clean.total) {
    throw new Error(`Clean mix adds up to ${assignments.length}, expected ${PARAMS.clean.total}`);
  }
  for (const { slot, provider } of assignments) {
    placeNew(ctx, { slot, label: null, amount: sampleAmount(rng, slot.codes, config), providers: [provider] });
  }
}
