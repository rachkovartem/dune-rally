// src/render/buggyMesh.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import type { CarAssembly, CarPart, CarWheelParts } from './carModel';
import type { CarMaterialSlot, WheelSlot } from '../assets/carPartRules';
import type { CarId } from '../vehicle/cars';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';
import { setBrakeLights } from './carMaterials';

// Each test gets a fresh module, so the per-car asset registry starts empty every time.
async function freshBuggyMesh(): Promise<typeof import('./buggyMesh')> {
  vi.resetModules();
  return import('./buggyMesh');
}

const NO_MAPS = { map: null, normalMap: null };

function part(name: string, slot: CarMaterialSlot, embeddedMaps: CarPart['embeddedMaps'] = NO_MAPS): CarPart {
  return { name, geometry: new THREE.BoxGeometry(0.2, 0.2, 0.2), slot, embeddedMaps };
}

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

function assemblyWith(wheelPartsFor: (slot: WheelSlot) => CarWheelParts, bodyParts: CarPart[] = [part('body-paint', 'paint')]): CarAssembly {
  const wheelParts: Record<WheelSlot, CarWheelParts> = {
    wheelFL: wheelPartsFor('wheelFL'),
    wheelFR: wheelPartsFor('wheelFR'),
    wheelRL: wheelPartsFor('wheelRL'),
    wheelRR: wheelPartsFor('wheelRR'),
  };
  return {
    bodyParts,
    wheelParts,
    fit: { bodyScale: 1, bodyOffset: { x: 0, y: 0.3, z: 0 }, wheelScale: 1, wheelInsetX: 0 },
  };
}

/** A Pajero-shaped rig: tyre and rim roll, nothing is fixed to the hub. */
const pajeroShapedAssembly = (): CarAssembly =>
  assemblyWith((slot) => ({ spinning: [part(slot, 'rubber'), part(`${slot}Rim`, 'rim')], hubFixed: [] }));

/** A Forester-shaped rig: every corner also carries a brake disc and a caliper that steer but do not roll. */
const foresterShapedAssembly = (): CarAssembly =>
  assemblyWith((slot) => ({
    spinning: [part(slot, 'rubber'), part(`${slot}Rim`, 'rim'), part(`${slot}RimDark`, 'rimDark')],
    hubFixed: [part(`brake-${slot}`, 'brake'), part(`caliper-${slot}`, 'blackTrim')],
  }));

const meshNamesIn = (object: THREE.Object3D): string[] => object.children.map((child) => child.name);

describe('buildBuggyMesh(carId) — rig contract Buggy.ts and PlayerViews depend on (R49–R51, R70)', () => {
  let buggyMesh: typeof import('./buggyMesh');
  beforeEach(async () => {
    buggyMesh = await freshBuggyMesh();
  });

  it('throws and names the car when no asset was registered for that id', () => {
    // Rule 14: a missing model must never quietly turn into another car's model or an empty group.
    expect(() => buggyMesh.buildBuggyMesh('pajero')).toThrow('buildBuggyMesh: no asset registered for pajero');
  });

  it('builds only the car whose asset was registered, not the other one', () => {
    buggyMesh.registerCarAsset('forester', foresterShapedAssembly());
    expect(() => buggyMesh.buildBuggyMesh('forester')).not.toThrow();
    expect(() => buggyMesh.buildBuggyMesh('pajero')).toThrow('no asset registered for pajero');
  });

  it.each<CarId>(['pajero', 'forester'])('returns exactly 5 children for %s: one body and four wheel pivots', (carId) => {
    // Buggy.ts does `mesh.children.slice(1)` for the pivots: an extra or missing child shifts every wheel index.
    buggyMesh.registerCarAsset(carId, carId === 'pajero' ? pajeroShapedAssembly() : foresterShapedAssembly());
    expect(buggyMesh.buildBuggyMesh(carId).children).toHaveLength(5);
  });

  it('puts the body parts in children[0] and nothing of a wheel there', () => {
    buggyMesh.registerCarAsset('pajero', pajeroShapedAssembly());
    const body = buggyMesh.buildBuggyMesh('pajero').children[0];
    expect(meshNamesIn(body)).toEqual(['body-paint']);
  });

  it.each<CarId>(['pajero', 'forester'])(
    'places pivots 1..4 at the %s config wheel positions, in FL, FR, RL, RR order',
    (carId) => {
      // The two cars have different wheel geometry: a pivot built from the other car's config
      // would draw the wheels away from where that car's physics holds them.
      buggyMesh.registerCarAsset(carId, pajeroShapedAssembly());
      const pivots = buggyMesh.buildBuggyMesh(carId).children.slice(1);
      const expected = vehicleConfigFor(carId).wheel.positions;
      pivots.forEach((pivot, wheelIndex) => {
        expect(pivot.position.x).toBeCloseTo(expected[wheelIndex].x, 10);
        expect(pivot.position.y).toBeCloseTo(expected[wheelIndex].y, 10);
        expect(pivot.position.z).toBeCloseTo(expected[wheelIndex].z, 10);
      });
    },
  );

  it('routes each corner of the asset to its own pivot (FL parts under pivot 1, RR parts under pivot 4)', () => {
    buggyMesh.registerCarAsset('pajero', pajeroShapedAssembly());
    const pivots = buggyMesh.buildBuggyMesh('pajero').children.slice(1);
    WHEEL_SLOTS.forEach((slot, wheelIndex) => {
      expect(meshNamesIn(pivots[wheelIndex].children[0])).toEqual([slot, `${slot}Rim`]);
    });
  });

  it('gives a corner with no hub-fixed parts exactly one pivot child: the spinner', () => {
    buggyMesh.registerCarAsset('pajero', pajeroShapedAssembly());
    for (const pivot of buggyMesh.buildBuggyMesh('pajero').children.slice(1)) {
      expect(pivot.children).toHaveLength(1);
    }
  });

  it('puts only the rolling parts in the spinner and exactly the hub-fixed parts in a second child', () => {
    // Buggy.update rotates children[0] to roll the wheel. A brake caliper inside the spinner
    // would visibly spin with the tyre; a tyre outside it would steer but never roll.
    buggyMesh.registerCarAsset('forester', foresterShapedAssembly());
    const frontLeft = buggyMesh.buildBuggyMesh('forester').children[1];
    expect(frontLeft.children).toHaveLength(2);
    expect(meshNamesIn(frontLeft.children[0])).toEqual(['wheelFL', 'wheelFLRim', 'wheelFLRimDark']);
    expect(meshNamesIn(frontLeft.children[1])).toEqual(['brake-wheelFL', 'caliper-wheelFL']);
  });

  it('refuses a part that carries a colour map but no normal map', () => {
    // A half-textured tyre is a converter defect; drawing it with a generated tread would hide it.
    const colourOnly = { map: new THREE.Texture(), normalMap: null };
    buggyMesh.registerCarAsset('forester', assemblyWith((slot) => ({
      spinning: [part(slot, 'rubber', colourOnly)],
      hubFixed: [],
    })));
    expect(() => buggyMesh.buildBuggyMesh('forester')).toThrow('carries only one of its colour and normal maps');
  });

  it('refuses two different textures for the same slot', () => {
    const texturedTyre = (): CarPart['embeddedMaps'] => ({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
    buggyMesh.registerCarAsset('forester', assemblyWith((slot) => ({
      spinning: [part(slot, 'rubber', texturedTyre())],
      hubFixed: [],
    })));
    expect(() => buggyMesh.buildBuggyMesh('forester')).toThrow('the "rubber" parts carry different textures');
  });

  it('draws the car\'s own embedded tyre textures when every tyre shares one pair', () => {
    const shared = { map: new THREE.Texture(), normalMap: new THREE.Texture() };
    buggyMesh.registerCarAsset('forester', assemblyWith((slot) => ({ spinning: [part(slot, 'rubber', shared)], hubFixed: [] })));
    const rubber = buggyMesh.getCarMaterials(buggyMesh.buildBuggyMesh('forester')).rubber;
    expect(rubber.map).toBe(shared.map);
    expect(rubber.normalMap).toBe(shared.normalMap);
  });
});

describe('getCarMaterials — each built car keeps its own material set (R56)', () => {
  it('throws for a group that buildBuggyMesh did not build', async () => {
    const buggyMesh = await freshBuggyMesh();
    expect(() => buggyMesh.getCarMaterials(new THREE.Group())).toThrow('was not built by buildBuggyMesh()');
  });

  it('braking one car does not light the tail lights of another car in the same scene', async () => {
    const buggyMesh = await freshBuggyMesh();
    buggyMesh.registerCarAsset('forester', foresterShapedAssembly());
    buggyMesh.registerCarAsset('pajero', pajeroShapedAssembly());
    const forester = buggyMesh.getCarMaterials(buggyMesh.buildBuggyMesh('forester'));
    const pajero = buggyMesh.getCarMaterials(buggyMesh.buildBuggyMesh('pajero'));
    const secondForester = buggyMesh.getCarMaterials(buggyMesh.buildBuggyMesh('forester'));
    const pajeroIdle = pajero.taillight.emissiveIntensity;
    const secondForesterIdle = secondForester.taillight.emissiveIntensity;

    setBrakeLights(forester, true);

    expect(pajero.taillight.emissiveIntensity).toBe(pajeroIdle);
    expect(secondForester.taillight.emissiveIntensity).toBe(secondForesterIdle);
  });
});
