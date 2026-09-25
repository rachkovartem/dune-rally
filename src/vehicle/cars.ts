// src/vehicle/cars.ts
/** A car the player can pick: it has a model, materials, sounds and a picker button. */
export type CarId = 'forester' | 'pajero';

export const CAR_IDS: readonly CarId[] = ['forester', 'pajero'];

export const DEFAULT_CAR_ID: CarId = 'forester';

export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && CAR_IDS.some((carId) => carId === value);
}

function hasEveryCar<Value>(table: Partial<Record<CarId, Value>>): table is Record<CarId, Value> {
  return CAR_IDS.every((carId) => carId in table);
}

/** A per-car table built in CAR_IDS order, so a new car cannot be left out of it. */
export function mapCarIds<Value>(build: (carId: CarId) => Value): Record<CarId, Value> {
  const table: Partial<Record<CarId, Value>> = {};
  for (const carId of CAR_IDS) table[carId] = build(carId);
  if (!hasEveryCar(table)) throw new Error('mapCarIds: a car is missing from the table');
  return table;
}

/**
 * A car the driving model knows: every picked car plus the ones whose body model has not landed
 * yet. They drive on the bench only; a car joins CarId together with its model, so the game never
 * tries to load a model that does not exist.
 */
export type VehicleId = CarId | 'elantra';

export const VEHICLE_IDS: readonly VehicleId[] = [...CAR_IDS, 'elantra'];
