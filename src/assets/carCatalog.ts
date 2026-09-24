// src/assets/carCatalog.ts
// One entry per selectable car: its display label, model file, measured size and assembly rules.
import type { CarId } from '../vehicle/cars';
import type { CarAssemblyRules, MeasuredCarLike } from '../render/carModel';
import { PAJERO_ASSEMBLY_RULES, measuredCar } from './carPartRules';
import { FORESTER_ASSEMBLY_RULES, measuredCarForester } from './foresterPartRules';

/** Shown in the start overlay when the Forester GLB fails to load: it is gitignored and built locally. */
export const FORESTER_MODEL_MISSING_MESSAGE =
  'Forester model missing — run npx tsx scripts/convert-forester.ts <fbx>';

export interface CarDefinition {
  label: string;
  modelUrl: string;
  measured: MeasuredCarLike;
  rules: CarAssemblyRules;
}

const CAR_DEFINITIONS: Partial<Record<CarId, CarDefinition>> = {
  forester: {
    label: 'Subaru Forester',
    modelUrl: '/models/forester-2019.glb',
    measured: measuredCarForester,
    rules: FORESTER_ASSEMBLY_RULES,
  },
  pajero: {
    label: 'Mitsubishi Pajero Sport',
    modelUrl: '/models/pajero-sport.glb',
    measured: measuredCar,
    rules: PAJERO_ASSEMBLY_RULES,
  },
};

/** Throws for a car whose model is not converted yet, so a missing car never turns into another. */
export function carDefinitionFor(carId: CarId): CarDefinition {
  const definition = CAR_DEFINITIONS[carId];
  if (!definition) throw new Error(`carDefinitionFor: the "${carId}" car is not converted yet`);
  return definition;
}
