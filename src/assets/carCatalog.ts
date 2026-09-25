// src/assets/carCatalog.ts
// One entry per selectable car: its display label, model file, measured size and assembly rules.
import type { VehicleId } from '../vehicle/cars';
import type { CarAssemblyRules, MeasuredCarLike } from '../render/carModel';
import { PAJERO_ASSEMBLY_RULES, measuredCar } from './carPartRules';
import { ELANTRA_ASSEMBLY_RULES, measuredCarElantra } from './elantraPartRules';
import { FORESTER_ASSEMBLY_RULES, measuredCarForester } from './foresterPartRules';

/** Shown in the start overlay when the Forester GLB fails to load: it is gitignored and built locally. */
export const FORESTER_MODEL_MISSING_MESSAGE =
  'Forester model missing — run npx tsx scripts/convert-forester.ts <fbx>';

/** Shown in the start overlay when the Elantra GLB fails to load: it is gitignored and built locally. */
export const ELANTRA_MODEL_MISSING_MESSAGE =
  'Elantra model missing — run npx tsx scripts/convert-elantra.ts <glb>';

/** The side of the cabin the steering wheel is on, as the driver sees it. */
export type DriverSide = 'left' | 'right';

export interface CarDefinition {
  label: string;
  modelUrl: string;
  measured: MeasuredCarLike;
  rules: CarAssemblyRules;
  /** Where the cockpit camera puts the driver's eye. */
  driverSide: DriverSide;
}

// Keyed by VehicleId so a car can land its model before it joins the picker (CarId).
const CAR_DEFINITIONS: Partial<Record<VehicleId, CarDefinition>> = {
  elantra: {
    label: 'Hyundai Elantra',
    modelUrl: '/models/elantra-2016.glb',
    measured: measuredCarElantra,
    rules: ELANTRA_ASSEMBLY_RULES,
    // The model's cabin has seats but no steering wheel; the left-hand-drive version is assumed.
    driverSide: 'left',
  },
  forester: {
    label: 'Subaru Forester',
    modelUrl: '/models/forester-2019.glb',
    measured: measuredCarForester,
    rules: FORESTER_ASSEMBLY_RULES,
    // Measured on the model's interior: the steering wheel sits left of the centreline.
    driverSide: 'left',
  },
  pajero: {
    label: 'Mitsubishi Pajero Sport',
    modelUrl: '/models/pajero-sport.glb',
    measured: measuredCar,
    rules: PAJERO_ASSEMBLY_RULES,
    // The model has no cabin to measure; the left-hand-drive market version is assumed.
    driverSide: 'left',
  },
};

/** Throws for a car whose model is not converted yet, so a missing car never turns into another. */
export function carDefinitionFor(carId: VehicleId): CarDefinition {
  const definition = CAR_DEFINITIONS[carId];
  if (!definition) throw new Error(`carDefinitionFor: the "${carId}" car is not converted yet`);
  return definition;
}
