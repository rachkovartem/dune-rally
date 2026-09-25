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
    // A copy-paste slip here would put the Pajero body on the Forester's physics everywhere.
    expect(carDefinitionFor('forester').modelUrl).not.toBe(carDefinitionFor('pajero').modelUrl);
    expect(carDefinitionFor('forester').label).not.toBe(carDefinitionFor('pajero').label);
  });

  it('pairs each car with its own assembly rules', () => {
    // Only the Forester has hub-fixed brake discs; the Pajero's rules do not know them.
    expect(carDefinitionFor('forester').rules.wheelCornerOf('brakeRL')).toBe('wheelRL');
    expect(() => carDefinitionFor('pajero').rules.slotFor('brakeRL')).toThrow();
    expect(carDefinitionFor('pajero').rules.needsCylindricalUv('wheelFL')).toBe(true);
    expect(carDefinitionFor('forester').rules.needsCylindricalUv('wheelFL')).toBe(false);
  });

  it('gives the two cars their own measured sizes', () => {
    expect(carDefinitionFor('forester').measured.wheelbase).not.toBe(carDefinitionFor('pajero').measured.wheelbase);
  });
});
