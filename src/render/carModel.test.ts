// src/render/carModel.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ARCH_CLEARANCE, assembleCar, cylindricalUv, fitCarToChassis, type CarAssemblyRules, type CarFit, type MeasuredCarLike } from './carModel';
import { measuredCarForester } from '../assets/foresterPartRules';
import { measuredCarPajeroGen3 } from '../assets/pajeroGen3PartRules';
import { measuredCarElantra } from '../assets/elantraPartRules';
import { restingSuspensionLength, vehicleConfigFor, type VehicleConfig } from '../vehicle/vehicleConfig';
import type { CarMaterialSlot, WheelSlot } from '../assets/carPartRules';

/** Height of the tyre top above the chassis origin once the car rests on its springs. */
const restingTyreTop = (config: VehicleConfig): number =>
  config.wheel.positions[0].y - restingSuspensionLength(config.wheel) + config.wheel.radius;

// Replacement (Pajero gen-3): the game draws the gen-3 model now, so its measurements are the ones fitted.
const fits: [string, MeasuredCarLike, VehicleConfig][] = [
  ['Pajero', measuredCarPajeroGen3, vehicleConfigFor('pajero')],
  ['Forester', measuredCarForester, vehicleConfigFor('forester')],
  ['Elantra', measuredCarElantra, vehicleConfigFor('elantra')],
];

describe('fitCarToChassis — the model sits on the physics wheels (R38–R41, R102–R104)', () => {
  it.each(fits)('scales the %s wheels to the physics tyre radius', (_name, measured, config) => {
    const fit = fitCarToChassis(measured, config);
    expect(measured.tyreRadius * fit.wheelScale).toBeCloseTo(config.wheel.radius, 9);
  });

  it.each(fits)('scales the %s body so its wheelbase matches the physics wheelbase', (_name, measured, config) => {
    const fit = fitCarToChassis(measured, config);
    const physicsWheelbase = config.wheel.positions[0].z - config.wheel.positions[2].z;
    expect(measured.wheelbase * fit.bodyScale).toBeCloseTo(physicsWheelbase, 9);
  });

  it.each(fits)('lifts the %s body so its wheel arch clears the resting tyre top by ARCH_CLEARANCE', (_name, measured, config) => {
    // Too low and the tyres cut through the fenders; too high and a gap shows over every wheel.
    const fit = fitCarToChassis(measured, config);
    const archTop = measured.archTopY * fit.bodyScale + fit.bodyOffset.y;
    expect(archTop - restingTyreTop(config)).toBeCloseTo(ARCH_CLEARANCE, 9);
  });

  it.each(fits)('moves the %s wheel meshes in under the scaled fender openings', (_name, measured, config) => {
    const fit = fitCarToChassis(measured, config);
    const drawnHalfTrack = Math.abs(config.wheel.positions[0].x) - fit.wheelInsetX;
    expect(drawnHalfTrack).toBeCloseTo((measured.track / 2) * fit.bodyScale, 9);
  });

  it('keeps the Forester at its real scale: body and wheels within 2 % of 1', () => {
    // The Forester config uses the converted model's own wheel geometry (plan v2 Tech Decisions).
    const fit = fitCarToChassis(measuredCarForester, vehicleConfigFor('forester'));
    expect(Math.abs(fit.bodyScale - 1)).toBeLessThan(0.01);
    expect(Math.abs(fit.wheelScale - 1)).toBeLessThan(0.02);
  });

  it('lowers the body by exactly the extra spring sag of a softer suspension', () => {
    // The Pajero was once fitted to a guessed sag while Rapier rested it elsewhere: the wheels sank.
    const base = vehicleConfigFor('pajero');
    const softer: VehicleConfig = { ...base, wheel: { ...base.wheel, suspensionStiffness: base.wheel.suspensionStiffness / 2 } };
    const extraSag = restingSuspensionLength(base.wheel) - restingSuspensionLength(softer.wheel);
    expect(extraSag).toBeGreaterThan(0);
    const offsetChange = fitCarToChassis(measuredCarPajeroGen3, softer).bodyOffset.y - fitCarToChassis(measuredCarPajeroGen3, base).bodyOffset.y;
    expect(offsetChange).toBeCloseTo(extraSag, 9);
  });

  it.each([0, -1.2, Number.NaN])('throws for a measured wheelbase of %s instead of producing an infinite scale', (wheelbase) => {
    expect(() => fitCarToChassis({ ...measuredCarPajeroGen3, wheelbase }, vehicleConfigFor('pajero'))).toThrow('measured.wheelbase must be > 0');
  });
});

describe('cylindricalUv — tread coordinates around the wheel axis (R42)', () => {
  /** A ring of vertices round the X axis at x = `axisValue`. */
  const ring = (axisValue: number, count: number): number[] =>
    Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      return [axisValue, Math.cos(angle), Math.sin(angle)];
    }).flat();

  it('keeps u in [0, 1) all the way round, including at the wrap', () => {
    const uv = cylindricalUv(Float32Array.from([...ring(0, 64), 0, -1, 0, 0, -1, -1e-3, 0, -1, 1e-3]), 'x');
    for (let vertex = 0; vertex < uv.length / 2; vertex++) {
      expect(uv[vertex * 2]).toBeGreaterThanOrEqual(0);
      expect(uv[vertex * 2]).toBeLessThan(1);
    }
  });

  it('puts two opposite points of the tread half a turn apart in u', () => {
    const uv = cylindricalUv(Float32Array.from([0, 0.3, 0.2, 0, -0.3, -0.2]), 'x');
    expect(Math.abs(uv[0] - uv[2])).toBeCloseTo(0.5, 6);
  });

  it('runs v from 0 on one sidewall to 1 on the other, 0.5 in the middle', () => {
    const uv = cylindricalUv(Float32Array.from([...ring(-0.1, 4), ...ring(0.05, 4), ...ring(0.2, 4)]), 'x');
    expect(uv[1]).toBeCloseTo(0, 6);
    expect(uv[4 * 2 + 1]).toBeCloseTo(0.5, 6);
    expect(uv[8 * 2 + 1]).toBeCloseTo(1, 6);
  });

  it('gives a flat disc (no width along the axis) a finite v instead of NaN', () => {
    const uv = cylindricalUv(Float32Array.from(ring(0.3, 8)), 'x');
    for (const value of uv) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('assembleCar(scene, fit, rules) — routes each node where the car\'s rules say (R71, R72)', () => {
  const FIT: CarFit = { bodyScale: 2, bodyOffset: { x: 0, y: 0.1, z: 0 }, wheelScale: 1, wheelInsetX: 0 };
  const HUBS: Record<WheelSlot, [number, number, number]> = {
    wheelFL: [-0.8, 0.35, 1.4], wheelFR: [0.8, 0.35, 1.4], wheelRL: [-0.8, 0.35, -1.2], wheelRR: [0.8, 0.35, -1.2],
  };
  const CORNERS = Object.keys(HUBS).filter((key): key is WheelSlot => key in HUBS);

  // A tiny rule set: `<corner>` is the tyre, `<corner>Rim` rolls with it, `<corner>Brake` is fixed to the hub.
  const rules: CarAssemblyRules = {
    wheelCornerOf: (nodeId) => CORNERS.find((corner) => nodeId.startsWith(corner)) ?? null,
    spinsWithWheel: (nodeId) => !nodeId.endsWith('Brake'),
    slotFor: (nodeId): CarMaterialSlot => (nodeId.endsWith('Brake') ? 'brake' : nodeId.endsWith('Rim') ? 'rim' : CORNERS.some((corner) => corner === nodeId) ? 'rubber' : 'paint'),
    tyreNodeIdOf: (slot) => slot,
    needsCylindricalUv: () => false,
  };

  function mesh(name: string, position: [number, number, number], material: THREE.Material = new THREE.MeshStandardMaterial()): THREE.Mesh {
    const node = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
    node.name = name;
    node.position.set(...position);
    return node;
  }

  function carScene(skip: string[] = []): THREE.Group {
    const scene = new THREE.Group();
    scene.add(mesh('hood', [0, 0.9, 1.5]));
    for (const corner of CORNERS) {
      for (const name of [corner, `${corner}Rim`, `${corner}Brake`]) {
        if (!skip.includes(name)) scene.add(mesh(name, HUBS[corner]));
      }
    }
    return scene;
  }

  const namesOf = (parts: { name: string }[]): string[] => parts.map((part) => part.name);

  it('keeps body nodes in the body and splits each corner into rolling and hub-fixed parts', () => {
    const assembly = assembleCar(carScene(), FIT, rules);
    expect(namesOf(assembly.bodyParts)).toEqual(['hood']);
    for (const corner of CORNERS) {
      expect(namesOf(assembly.wheelParts[corner].spinning)).toEqual([corner, `${corner}Rim`]);
      expect(namesOf(assembly.wheelParts[corner].hubFixed)).toEqual([`${corner}Brake`]);
    }
  });

  it('puts the tyre first in the spinner, whatever order the file lists the nodes in', () => {
    const scene = new THREE.Group();
    scene.add(mesh('hood', [0, 0.9, 1.5]));
    for (const corner of CORNERS) {
      scene.add(mesh(`${corner}Rim`, HUBS[corner]));
      scene.add(mesh(corner, HUBS[corner]));
    }
    const assembly = assembleCar(scene, FIT, rules);
    for (const corner of CORNERS) expect(assembly.wheelParts[corner].spinning[0].name).toBe(corner);
  });

  it('gives every part the material slot the rules name', () => {
    const assembly = assembleCar(carScene(), FIT, rules);
    expect(assembly.bodyParts[0].slot).toBe('paint');
    expect(assembly.wheelParts.wheelRR.spinning.map((part) => part.slot)).toEqual(['rubber', 'rim']);
    expect(assembly.wheelParts.wheelRR.hubFixed[0].slot).toBe('brake');
  });

  it('centres every wheel part on its own tyre hub, so it spins round its axle', () => {
    const assembly = assembleCar(carScene(), FIT, rules);
    for (const corner of CORNERS) {
      for (const part of [...assembly.wheelParts[corner].spinning, ...assembly.wheelParts[corner].hubFixed]) {
        part.geometry.computeBoundingBox();
        const centre = part.geometry.boundingBox?.getCenter(new THREE.Vector3());
        expect(centre?.length()).toBeCloseTo(0, 5);
      }
    }
  });

  it('keeps body parts in car space and centres the body on the wheelbase', () => {
    const assembly = assembleCar(carScene(), FIT, rules);
    assembly.bodyParts[0].geometry.computeBoundingBox();
    expect(assembly.bodyParts[0].geometry.boundingBox?.getCenter(new THREE.Vector3()).z).toBeCloseTo(1.5, 5);
    const wheelbaseCentreZ = (HUBS.wheelFL[2] + HUBS.wheelRL[2]) / 2;
    expect(assembly.fit.bodyOffset.z).toBeCloseTo(-wheelbaseCentreZ * FIT.bodyScale, 9);
    expect(assembly.fit.bodyOffset.y).toBe(FIT.bodyOffset.y);
  });

  it('carries the textures a node\'s material brings, and null (never a stand-in) when it has none', () => {
    const map = new THREE.Texture();
    const normalMap = new THREE.Texture();
    const scene = carScene(['wheelFL']);
    scene.add(mesh('wheelFL', HUBS.wheelFL, new THREE.MeshStandardMaterial({ map, normalMap })));
    const assembly = assembleCar(scene, FIT, rules);
    expect(assembly.wheelParts.wheelFL.spinning[0].embeddedMaps).toEqual({ map, normalMap });
    expect(assembly.bodyParts[0].embeddedMaps).toEqual({ map: null, normalMap: null });
    expect(assembly.wheelParts.wheelFL.spinning[1].embeddedMaps).toEqual({ map: null, normalMap: null });
  });

  it('gives a node whose material is not a standard material no textures', () => {
    const scene = carScene();
    scene.add(mesh('roofRack', [0, 1.6, 0], new THREE.MeshBasicMaterial({ map: new THREE.Texture() })));
    const rack = assembleCar(scene, FIT, rules).bodyParts.find((part) => part.name === 'roofRack');
    expect(rack?.embeddedMaps).toEqual({ map: null, normalMap: null });
  });

  it('throws and names the missing tyre when a corner has parts but no tyre', () => {
    expect(() => assembleCar(carScene(['wheelRR']), FIT, rules)).toThrow('missing the "wheelRR" tyre mesh');
  });

  it('adds a cylindrical UV only to the nodes the rules ask for', () => {
    const withTread: CarAssemblyRules = { ...rules, needsCylindricalUv: (nodeId) => nodeId === 'wheelFL' };
    const scene = carScene();
    for (const child of scene.children) {
      if (child instanceof THREE.Mesh) child.geometry.deleteAttribute('uv');
    }
    const assembly = assembleCar(scene, FIT, withTread);
    expect(assembly.wheelParts.wheelFL.spinning[0].geometry.getAttribute('uv')).toBeDefined();
    expect(assembly.wheelParts.wheelFR.spinning[0].geometry.getAttribute('uv')).toBeUndefined();
  });
});
