// src/vehicle/vehicleConfig.test.ts
// Where Rapier actually rests each car is checked against this formula in shared/vehiclePhysics.test.ts;
// here are the formula's own edges.
import { describe, it, expect } from 'vitest';
import { restingSuspensionLength } from './vehicleConfig';

const fourWheels = [
  { x: -1, y: -0.4, z: 1.4 }, { x: 1, y: -0.4, z: 1.4 },
  { x: -1, y: -0.4, z: -1.4 }, { x: 1, y: -0.4, z: -1.4 },
];

describe('restingSuspensionLength', () => {
  it('is always shorter than the unloaded rest length: gravity compresses the spring', () => {
    expect(restingSuspensionLength({ suspensionRestLength: 0.5, suspensionStiffness: 30, positions: fourWheels }))
      .toBeLessThan(0.5);
  });

  it('sags less on a stiffer spring', () => {
    const soft = restingSuspensionLength({ suspensionRestLength: 0.5, suspensionStiffness: 20, positions: fourWheels });
    const stiff = restingSuspensionLength({ suspensionRestLength: 0.5, suspensionStiffness: 60, positions: fourWheels });
    expect(stiff).toBeGreaterThan(soft);
  });

  it('sags less when the weight is shared by more wheels', () => {
    const twoWheels = fourWheels.slice(0, 2);
    const onTwo = restingSuspensionLength({ suspensionRestLength: 0.5, suspensionStiffness: 30, positions: twoWheels });
    const onFour = restingSuspensionLength({ suspensionRestLength: 0.5, suspensionStiffness: 30, positions: fourWheels });
    expect(onFour).toBeGreaterThan(onTwo);
  });
});
