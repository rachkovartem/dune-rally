// src/render/carViewPoints.test.ts
import { describe, it, expect } from 'vitest';
import { carViewPointsFrom, type CarBodySample, type CarPoint } from './carViewPoints';

const FRONT_AXLE = 1.35;
const REAR_AXLE = -1.35;
const HUBS: readonly CarPoint[] = [
  { x: -0.8, y: 0.3, z: FRONT_AXLE }, { x: 0.8, y: 0.3, z: FRONT_AXLE },
  { x: -0.8, y: 0.3, z: REAR_AXLE }, { x: 0.8, y: 0.3, z: REAR_AXLE },
];
const BONNET_TOP = 0.9;
const ROOF_TOP = 1.45;
const NOSE = 2.2;

/** A boxy car body sampled every 5 cm: a low bonnet ahead of z 0.9, a tall cabin behind it. */
function boxyCar(keep: (x: number, y: number, z: number) => boolean = () => true): number[] {
  const points: number[] = [];
  for (let z = -2.2; z <= NOSE + 1e-9; z += 0.05) {
    const top = z > 0.9 ? BONNET_TOP : ROOF_TOP;
    for (let x = -0.9; x <= 0.9 + 1e-9; x += 0.05) {
      for (let y = 0.3; y <= top + 1e-9; y += 0.05) {
        const onShell = Math.abs(Math.abs(x) - 0.9) < 1e-9 || Math.abs(y - top) < 1e-9 || Math.abs(y - 0.3) < 1e-9 || Math.abs(z - NOSE) < 1e-9;
        if (onShell && keep(x, y, z)) points.push(x, y, z);
      }
    }
  }
  return points;
}

const sample = (bodyPoints: number[], wheelHubs: readonly CarPoint[] = HUBS): CarBodySample => ({ bodyPoints, wheelHubs });

describe('carViewPointsFrom — the hood, bumper and cockpit cameras on a built car (camera modes)', () => {
  const points = carViewPointsFrom(sample(boxyCar()), 'left');

  it('puts the hood camera above the bonnet, behind the front axle', () => {
    expect(points.hood.y).toBeGreaterThan(BONNET_TOP);
    expect(points.hood.z).toBeLessThan(FRONT_AXLE);
    expect(points.hood.x).toBe(0);
  });

  it('puts the bumper camera just ahead of the nose, low on the front face', () => {
    expect(points.bumper.z).toBeGreaterThan(NOSE);
    expect(points.bumper.y).toBeLessThan(BONNET_TOP);
    expect(points.bumper.y).toBeGreaterThan(0.3);
  });

  it('puts the driver\'s eye under the roof, between the axles, on the driver\'s side', () => {
    expect(points.cockpit.y).toBeLessThan(ROOF_TOP);
    expect(points.cockpit.z).toBeLessThan(FRONT_AXLE);
    expect(points.cockpit.z).toBeGreaterThan(REAR_AXLE);
    // Car space has the nose at +Z and Y up, so the left seat is at +X.
    expect(points.cockpit.x).toBeGreaterThan(0);
    expect(carViewPointsFrom(sample(boxyCar()), 'right').cockpit.x).toBeLessThan(0);
  });

  it('throws for a car with no wheels', () => {
    expect(() => carViewPointsFrom(sample(boxyCar(), []), 'left')).toThrow('has no wheels');
  });

  it('throws when every wheel sits on one axle', () => {
    expect(() => carViewPointsFrom(sample(boxyCar(), HUBS.slice(0, 2)), 'left')).toThrow('share one axle');
  });

  it.each<[string, (x: number, y: number, z: number) => boolean]>([
    ['bonnet', (x, _y, z) => !(Math.abs(x) < 0.4 && z > 1.0 && z < 1.8)],
    ['roof', (x, _y, z) => !(Math.abs(x) < 0.4 && z > -0.3 && z < 0.3)],
    ['cabin sides', (_x, y, z) => !(z > -0.3 && z < 0.3 && y > 0.9)],
  ])('throws when the body has no vertices at the %s, instead of placing a camera inside the ground', (part, keep) => {
    expect(() => carViewPointsFrom(sample(boxyCar(keep)), 'left')).toThrow(`no vertices at the ${part}`);
  });

  it('throws for an empty body', () => {
    expect(() => carViewPointsFrom(sample([]), 'left')).toThrow('no vertices');
  });
});
