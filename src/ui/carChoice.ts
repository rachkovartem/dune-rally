// src/ui/carChoice.ts
import { carDefinitionFor } from '../assets/carCatalog';
import { mapCarIds, type CarId } from '../vehicle/cars';
import { sanitizeCarId } from '../../shared/protocol';

export const CAR_CHOICE_STORAGE_KEY = 'dune-rally.carId';

/** The car saved on an earlier visit; nothing saved or an unknown id gives the default car. */
export function readSavedCarId(storage: Pick<Storage, 'getItem'>): CarId {
  return sanitizeCarId(storage.getItem(CAR_CHOICE_STORAGE_KEY));
}

export function saveCarId(storage: Pick<Storage, 'setItem'>, carId: CarId): void {
  storage.setItem(CAR_CHOICE_STORAGE_KEY, carId);
}

export const CAR_LABELS: Readonly<Record<CarId, string>> = mapCarIds((carId) => carDefinitionFor(carId).label);
