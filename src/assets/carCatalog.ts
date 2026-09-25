// src/assets/carCatalog.ts
// One entry per selectable car: its display label, model file, measured size and assembly rules.
import type { CarId } from '../vehicle/cars';
import type { CarAssemblyRules, MeasuredCarLike } from '../render/carModel';
import { ELANTRA_ASSEMBLY_RULES, measuredCarElantra } from './elantraPartRules';
import { FORESTER_ASSEMBLY_RULES, measuredCarForester } from './foresterPartRules';
import { PAJERO_GEN3_ASSEMBLY_RULES, measuredCarPajeroGen3 } from './pajeroGen3PartRules';

/** Shown in the start overlay when the Forester GLB fails to load: it is gitignored and built locally. */
export const FORESTER_MODEL_MISSING_MESSAGE =
  'Forester model missing — run npx tsx scripts/convert-forester.ts <fbx>';

/** Shown in the start overlay when the Elantra GLB fails to load: it is gitignored and built locally. */
export const ELANTRA_MODEL_MISSING_MESSAGE =
  'Elantra model missing — run npx tsx scripts/convert-elantra.ts <glb>';

/** Shown in the start overlay when the Pajero GLB fails to load: it is gitignored and built locally. */
export const PAJERO_MODEL_MISSING_MESSAGE =
  'Pajero model missing — run npx tsx scripts/convert-pajero.ts <glb>';

/** The side of the cabin the steering wheel is on, as the driver sees it. */
export type DriverSide = 'left' | 'right';

/**
 * A model that is gitignored and built on the owner's machine, so a fresh clone does not have it.
 * `requiredToPlay` false: the game starts without it and only this car leaves the picker.
 */
export interface LocalModel {
  missingMessage: string;
  requiredToPlay: boolean;
}

export interface CarDefinition {
  label: string;
  modelUrl: string;
  measured: MeasuredCarLike;
  rules: CarAssemblyRules;
  /** Where the cockpit camera puts the driver's eye. */
  driverSide: DriverSide;
  /** False when the model has no inside: the cockpit camera then sits on the bonnet. */
  hasCabin: boolean;
  /** null for a model that is committed to the repo. */
  localModel: LocalModel | null;
}

const CAR_DEFINITIONS: Readonly<Record<CarId, CarDefinition>> = {
  elantra: {
    label: 'Hyundai Elantra',
    modelUrl: '/models/elantra-2016.glb',
    measured: measuredCarElantra,
    rules: ELANTRA_ASSEMBLY_RULES,
    // The model's cabin has seats but no steering wheel; the left-hand-drive version is assumed.
    driverSide: 'left',
    hasCabin: true,
    localModel: { missingMessage: ELANTRA_MODEL_MISSING_MESSAGE, requiredToPlay: false },
  },
  forester: {
    label: 'Subaru Forester',
    modelUrl: '/models/forester-2019.glb',
    measured: measuredCarForester,
    rules: FORESTER_ASSEMBLY_RULES,
    // Measured on the model's interior: the steering wheel sits left of the centreline.
    driverSide: 'left',
    hasCabin: true,
    // The default car: without it there is nothing to fall back to.
    localModel: { missingMessage: FORESTER_MODEL_MISSING_MESSAGE, requiredToPlay: true },
  },
  pajero: {
    label: 'Mitsubishi Pajero Sport',
    modelUrl: '/models/pajero-sport-2020.glb',
    measured: measuredCarPajeroGen3,
    rules: PAJERO_GEN3_ASSEMBLY_RULES,
    // Measured on the model's interior: the steering wheel sits right of the centreline (x -0.43).
    driverSide: 'right',
    hasCabin: true,
    localModel: { missingMessage: PAJERO_MODEL_MISSING_MESSAGE, requiredToPlay: false },
  },
};

export function carDefinitionFor(carId: CarId): CarDefinition {
  return CAR_DEFINITIONS[carId];
}
