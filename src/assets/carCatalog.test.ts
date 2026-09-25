// src/assets/carCatalog.test.ts
import { describe, it, expect } from 'vitest';
import { carDefinitionFor } from './carCatalog';
import { CAR_IDS } from '../vehicle/cars';

describe('carDefinitionFor (R75, R101)', () => {
  it.each(CAR_IDS)('gives the %s a model file under /models/ and a real measured size', (carId) => {
    const definition = carDefinitionFor(carId);
    expect(definition.modelUrl).toMatch(/^\/models\/.+\.glb$/);
    expect(definition.measured.wheelbase).toBeGreaterThan(0);
    expect(definition.measured.tyreRadius).toBeGreaterThan(0);
  });

  it('loads a different model and shows a different name for each car', () => {
    // A copy-paste slip here would put one car's body on another car's physics everywhere.
    // Replacement (E1): three cars, not two.
    const definitions = CAR_IDS.map(carDefinitionFor);
    expect(new Set(definitions.map((definition) => definition.modelUrl)).size).toBe(CAR_IDS.length);
    expect(new Set(definitions.map((definition) => definition.label)).size).toBe(CAR_IDS.length);
  });

  it('pairs each car with its own assembly rules', () => {
    // Only the Forester has hub-fixed brake discs; the Pajero's rules do not know them.
    expect(carDefinitionFor('forester').rules.wheelCornerOf('brakeRL')).toBe('wheelRL');
    expect(() => carDefinitionFor('pajero').rules.slotFor('brakeRL')).toThrow();
    expect(carDefinitionFor('pajero').rules.needsCylindricalUv('wheelFL')).toBe(true);
    expect(carDefinitionFor('forester').rules.needsCylindricalUv('wheelFL')).toBe(false);
  });

  it('gives every car its own measured size', () => {
    expect(new Set(CAR_IDS.map((carId) => carDefinitionFor(carId).measured.wheelbase)).size).toBe(CAR_IDS.length);
  });

  it('pairs the Elantra with its own rules: it has no brake discs, and its tyres take the generated tread (E1)', () => {
    expect(() => carDefinitionFor('elantra').rules.slotFor('brakeRL')).toThrow();
    expect(carDefinitionFor('elantra').rules.needsCylindricalUv('wheelFL')).toBe(true);
  });
});
