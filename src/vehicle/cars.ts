// src/vehicle/cars.ts
export type CarId = 'forester' | 'pajero';

export const CAR_IDS: readonly CarId[] = ['forester', 'pajero'];

export const DEFAULT_CAR_ID: CarId = 'forester';

export function isCarId(value: unknown): value is CarId {
  return typeof value === 'string' && CAR_IDS.some((carId) => carId === value);
}
