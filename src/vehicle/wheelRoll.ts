// src/vehicle/wheelRoll.ts

/**
 * Most turn (rad) the wheelspin may add to a drawn wheel in one physics step. Past about half a
 * spoke gap per frame a spoked rim strobes and looks still or turning backwards, so a fast spin is
 * drawn at this rate. Plain rolling is never slowed: a wheel that only rolls turns as it always did.
 */
export const MAX_DRAWN_SPIN_STEP = 0.6;

/**
 * The drawn wheel's angle after one step. `groundSpeed` is the car's speed along its nose and
 * `surfaceSpeed` the speed of this tyre's tread (the ground speed plus its own wheelspin), m/s.
 */
export function advanceRollAngle(angle: number, groundSpeed: number, surfaceSpeed: number, dt: number, radius: number): number {
  const rolling = Math.abs((groundSpeed * dt) / radius);
  const turning = (surfaceSpeed * dt) / radius;
  const limit = Math.max(rolling, MAX_DRAWN_SPIN_STEP);
  if (Math.abs(turning) <= limit) return angle + turning;
  return angle + Math.sign(turning) * limit;
}
