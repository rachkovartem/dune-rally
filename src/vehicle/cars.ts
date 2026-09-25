// src/vehicle/cars.ts
/** A car the player can pick: it has a model, materials, sounds and a picker button. */
export type CarId = 'forester' | 'pajero';

export const CAR_IDS: readonly CarId[] = ['forester', 'pajero'];

export const DEFAULT_CAR_ID: CarId = 'forester';

export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && CAR_IDS.some((carId) => carId === value);
}

/**
 * A car the driving model knows: every picked car plus the ones whose body model has not landed
 * yet. They drive on the bench only; a car joins CarId together with its model, so the game never
 * tries to load a model that does not exist.
 */
export type VehicleId = CarId | 'elantra';

export const VEHICLE_IDS: readonly VehicleId[] = [...CAR_IDS, 'elantra'];
