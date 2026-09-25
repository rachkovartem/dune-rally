// src/assets/pajeroGen3PartRules.test.ts
// Replacement (Pajero gen-3): these rows take over from the old razkat90 Pajero rules, whose model
// the game no longer loads. Category 1 (pure rules) plus the contract with the converted local GLB.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, getBounds, type Node as GltfNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import {
  PAJERO_BADGE_COMPONENTS,
  PAJERO_CABIN_SHELL,
  PAJERO_HUB,
  PAJERO_SOURCE,
  PAJERO_WHEEL_Z,
  classifyPajeroPart,
  pajeroBadgeReasonOf,
  pajeroCarSpacePoint,
  pajeroHubOf,
  pajeroMaterialSlotFor,
  pajeroNeedsInsideFace,
  pajeroPlateQuad,
  pajeroRawKeyOf,
  type PajeroBox,
  type PajeroPartSample,
} from './pajeroGen3PartRules';
import type { WheelSlot } from './carPartRules';
import { carDefinitionFor } from './carCatalog';

// The rules as the renderer receives them, through the car catalog.
const PAJERO_RULES = carDefinitionFor('pajero').rules;
const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const TYRE_KEY = 'car////Geom3D|[Color J08]';
const CALIPER_KEY = 'car////silver_12/Geom3D|gum';
const GRILLE_KEY = 'car/body/skpF5A1/bump_front_o/Geom3D|[Metal Corrugated Shiny]';
const ROOT = ['', 'mitsubishi+pajero+sport+2016#1', 'mitsubishi+pajero+sport+2016'];

const box = (min: [number, number, number], max: [number, number, number]): PajeroBox =>
  ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
const partAt = (rawKey: string, x: number, z: number, y: number = PAJERO_HUB.y): PajeroPartSample =>
  ({ rawKey, centre: { x, y, z }, size: { x: 0.29, y: 0.8, z: 0.8 } });

describe('pajeroCarSpacePoint — the source moved into car space (Pajero gen-3)', () => {
  it('puts the source origin point at the car-space origin', () => {
    const point = pajeroCarSpacePoint(PAJERO_SOURCE.origin);
    expect(point.x).toBeCloseTo(0, 12);
    expect(point.y).toBeCloseTo(0, 12);
    expect(point.z).toBeCloseTo(0, 12);
  });

  it('scales the source wheelbase (3.06 m) down to the real 2.8 m', () => {
    const front = pajeroCarSpacePoint({ x: 0, y: 0, z: 0 });
    const rear = pajeroCarSpacePoint({ x: 0, y: 0, z: -3.06 });
    expect(front.z - rear.z).toBeCloseTo(2.8, 9);
  });
});

describe('pajeroRawKeyOf — a stable key for one raw primitive (Pajero gen-3)', () => {
  it('folds a mirrored copy onto its original, so both sides get one rule', () => {
    const original = pajeroRawKeyOf([...ROOT, 'Door_front__50_', 'Geom3D'], 'Mitsubishi All New Pajero Sport - wire_4');
    const mirrored = pajeroRawKeyOf([...ROOT, 'Door_front__50__1', 'Geom3D'], 'Mitsubishi All New Pajero Sport - wire_4');
    expect(mirrored).toBe(original);
    expect(original).toBe('car/body/Door_front__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4');
  });

  it('marks a primitive with no material, and keeps an unnamed group as an empty name (the garage keys)', () => {
    const key = pajeroRawKeyOf(['', '', 'Geom3D_'], null);
    expect(key).toBe('/Geom3D_|(none)');
    expect(classifyPajeroPart({ rawKey: key, centre: { x: 0, y: 0, z: 0 }, size: { x: 9, y: 9, z: 9 } })).toEqual({ kind: 'deleted', reason: 'garage' });
  });

  it.each<[string, string[]]>([['a path outside the unnamed scene root', ['Scene', 'Geom3D']], ['a path with only the root', ['']]])('throws for %s', (_name, path) => {
    expect(() => pajeroRawKeyOf(path, null)).toThrow('does not start at the unnamed scene root');
  });
});

describe('classifyPajeroPart — delete it, or which clean node it joins (Pajero gen-3)', () => {
  it.each<[WheelSlot, number, number]>([
    ['wheelFL', -PAJERO_HUB.x, PAJERO_WHEEL_Z.front],
    ['wheelFR', PAJERO_HUB.x, PAJERO_WHEEL_Z.front],
    ['wheelRL', -PAJERO_HUB.x, PAJERO_WHEEL_Z.rear],
    ['wheelRR', PAJERO_HUB.x, PAJERO_WHEEL_Z.rear],
  ])('sends a tyre to %s by its side and axle (left = negative x in the game rig)', (wheel, x, z) => {
    expect(classifyPajeroPart(partAt(TYRE_KEY, x, z))).toMatchObject({ kind: 'part', cleanId: PAJERO_RULES.tyreNodeIdOf(wheel), slot: 'rubber' });
  });

  it('gives a wheel part the hub of its corner, so the node spins about the axle', () => {
    expect(classifyPajeroPart(partAt(TYRE_KEY, PAJERO_HUB.x, PAJERO_WHEEL_Z.rear)))
      .toMatchObject({ kind: 'part', hub: { x: PAJERO_HUB.x, y: PAJERO_HUB.y, z: PAJERO_WHEEL_Z.rear } });
  });

  it('keeps a body part in car space with no hub', () => {
    expect(classifyPajeroPart({ rawKey: 'car/body/Roof__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4', centre: { x: 0, y: 1.8, z: 0 }, size: { x: 1.5, y: 0.1, z: 2 } }))
      .toEqual({ kind: 'part', cleanId: 'paint', slot: 'paint', targetKey: 'paint', hub: null });
  });

  it('deletes the garage backdrop, the rear badge and the DAKAR script', () => {
    const sample = (rawKey: string): PajeroPartSample => ({ rawKey, centre: { x: 0, y: 1, z: 0 }, size: { x: 1, y: 1, z: 1 } });
    expect(classifyPajeroPart(sample('/Geom3D|[Asphalt New]'))).toEqual({ kind: 'deleted', reason: 'garage' });
    expect(classifyPajeroPart(sample('car/body/Logo_rear__50_/Geom3D|[Metal Corrugated Shiny]'))).toEqual({ kind: 'deleted', reason: 'rearBadge' });
    expect(classifyPajeroPart(sample('car/body/Trunk__50_/DAKAR/Geom3D|*3'))).toEqual({ kind: 'deleted', reason: 'modelScript' });
  });

  it('throws for a raw part nobody has identified, instead of guessing its material', () => {
    expect(() => classifyPajeroPart({ rawKey: 'car/new/Geom3D|[Color Z99]', centre: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } })).toThrow('no role');
  });
});

describe('pajeroHubOf — which corner a wheel part belongs to (Pajero gen-3)', () => {
  it('accepts a tyre 1.9 cm off the hub axis and rejects one 2.1 cm off', () => {
    expect(pajeroHubOf({ x: PAJERO_HUB.x, y: PAJERO_HUB.y + 0.019, z: PAJERO_WHEEL_Z.front }, 'tyre').wheel).toBe('wheelFR');
    expect(() => pajeroHubOf({ x: PAJERO_HUB.x, y: PAJERO_HUB.y + 0.021, z: PAJERO_WHEEL_Z.front }, 'tyre')).toThrow('off the nearest hub axis');
  });

  it('accepts a caliper 13 cm off the axle, where the real one sits, but not a tyre there', () => {
    const off = { x: PAJERO_HUB.x, y: PAJERO_HUB.y, z: PAJERO_WHEEL_Z.front + 0.13 };
    expect(pajeroHubOf(off, 'caliper').wheel).toBe('wheelFR');
    expect(() => pajeroHubOf(off, 'tyre')).toThrow('off the nearest hub axis');
  });

  it('rejects a part far along the axle, inside the body', () => {
    expect(() => pajeroHubOf({ x: 0.3, y: PAJERO_HUB.y, z: PAJERO_WHEEL_Z.rear }, 'rim')).toThrow('along it');
  });

  it('draws the caliper dark, not as the bright brake disc', () => {
    expect(classifyPajeroPart(partAt(CALIPER_KEY, -PAJERO_HUB.x, PAJERO_WHEEL_Z.front + 0.13))).toMatchObject({ kind: 'part', cleanId: 'caliperFL', slot: 'blackTrim' });
  });
});

describe('pajeroBadgeReasonOf — the three-diamond inside the grille part (Pajero gen-3)', () => {
  const badgeBox = PAJERO_BADGE_COMPONENTS[GRILLE_KEY].box;

  it('removes a piece that lies fully inside the badge box', () => {
    expect(pajeroBadgeReasonOf(GRILLE_KEY, box([-0.05, 0.95, 2.3], [0.05, 1.0, 2.35]))).toBe('frontBadge');
  });

  it('keeps a piece that crosses the badge box edge by 1 cm (the chrome side shields stay)', () => {
    expect(pajeroBadgeReasonOf(GRILLE_KEY, box([-0.05, 0.95, 2.3], [badgeBox.max.x + 0.01, 1.0, 2.35]))).toBeNull();
  });

  it('never removes anything from a part that has no badge rule', () => {
    expect(pajeroBadgeReasonOf('car/body/Roof__50_/Geom3D|Mitsubishi All New Pajero Sport - wire_4', box([-0.05, 0.95, 2.3], [0.05, 1.0, 2.35]))).toBeNull();
  });
});

describe('pajeroNeedsInsideFace — the cabin shell shows from the driver\'s seat (Pajero gen-3)', () => {
  const { box: cabin } = PAJERO_CABIN_SHELL;

  it('gives a roof or pillar triangle inside the cabin box a reversed copy', () => {
    expect(pajeroNeedsInsideFace('paint', { x: 0, y: 1.6, z: 0 })).toBe(true);
    expect(pajeroNeedsInsideFace('blackTrim', { x: cabin.min.x, y: cabin.max.y, z: cabin.max.z })).toBe(true);
  });

  it('gives none to a triangle just outside the cabin box, or to a slot that is not the shell', () => {
    expect(pajeroNeedsInsideFace('paint', { x: 0, y: 1.6, z: cabin.max.z + 0.01 })).toBe(false);
    expect(pajeroNeedsInsideFace('glass', { x: 0, y: 1.6, z: 0 })).toBe(false);
  });
});

describe('the Pajero assembly rules — how the renderer puts the converted car together (Pajero gen-3)', () => {
  it('finds each wheel\'s tyre node again from its id, spinning with the wheel and taking the generated tread', () => {
    for (const wheel of WHEEL_SLOTS) {
      const tyre = PAJERO_RULES.tyreNodeIdOf(wheel);
      expect(PAJERO_RULES.wheelCornerOf(tyre)).toBe(wheel);
      expect(PAJERO_RULES.spinsWithWheel(tyre)).toBe(true);
      expect(PAJERO_RULES.needsCylindricalUv(tyre)).toBe(true);
    }
  });

  it('spins the rims with the wheel and keeps the brake disc and caliper still on the hub', () => {
    for (const letters of ['FL', 'FR', 'RL', 'RR']) {
      expect(PAJERO_RULES.spinsWithWheel(`wheel${letters}Rim`)).toBe(true);
      expect(PAJERO_RULES.spinsWithWheel(`wheel${letters}RimDark`)).toBe(true);
      expect(PAJERO_RULES.spinsWithWheel(`brake${letters}`)).toBe(false);
      expect(PAJERO_RULES.spinsWithWheel(`caliper${letters}`)).toBe(false);
      expect(PAJERO_RULES.needsCylindricalUv(`wheel${letters}Rim`)).toBe(false);
    }
  });

  it('keeps body parts on the body: no wheel, no spin, no tread', () => {
    for (const nodeId of ['paint', 'plate', 'glass', 'interior']) {
      expect(PAJERO_RULES.wheelCornerOf(nodeId)).toBeNull();
      expect(PAJERO_RULES.spinsWithWheel(nodeId)).toBe(false);
      expect(PAJERO_RULES.needsCylindricalUv(nodeId)).toBe(false);
    }
  });

  it('throws for a node id the rules do not know, in every rule', () => {
    expect(() => pajeroMaterialSlotFor('badge')).toThrow('no material slot');
    expect(() => PAJERO_RULES.wheelCornerOf('badge')).toThrow('unknown node id');
    expect(() => PAJERO_RULES.spinsWithWheel('wheelXX')).toThrow('unknown node id');
  });
});

describe('pajeroPlateQuad — the blank rear plate (Pajero gen-3)', () => {
  it('faces backward and a little up, so it shows from behind the car', () => {
    const { positions, indices } = pajeroPlateQuad();
    const corner = (index: number): number[] => [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
    for (let triangle = 0; triangle < indices.length / 3; triangle++) {
      const [a, b, c] = [corner(indices[triangle * 3]), corner(indices[triangle * 3 + 1]), corner(indices[triangle * 3 + 2])];
      const edgeOne = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const edgeTwo = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const normalY = edgeOne[2] * edgeTwo[0] - edgeOne[0] * edgeTwo[2];
      const normalZ = edgeOne[0] * edgeTwo[1] - edgeOne[1] * edgeTwo[0];
      expect(normalZ).toBeLessThan(0);
      expect(normalY).toBeGreaterThan(0);
    }
  });
});

// The converted GLB is built on the owner's machine and is not in git (like the other two cars),
// so a fresh clone skips this contract instead of failing on a missing local asset.
const PAJERO_GLB = fileURLToPath(new URL('../../public/models/pajero-sport-2020.glb', import.meta.url));
const HAS_GLB = existsSync(PAJERO_GLB);

describe.skipIf(!HAS_GLB)('public/models/pajero-sport-2020.glb — the converted model contract (skipped when the local GLB is absent: run scripts/convert-pajero.ts)', () => {
  let document: Document;
  let nodes: GltfNode[];

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    document = await io.read(PAJERO_GLB);
    nodes = document.getRoot().listNodes().filter((node) => node.getMesh() !== null);
  });

  it('has only node ids the assembly rules know, none twice', () => {
    const ids = nodes.map((node) => node.getName());
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(() => PAJERO_RULES.slotFor(id)).not.toThrow();
  });

  it('has the tyre, both rims, the disc and the caliper of every corner', () => {
    const ids = new Set(nodes.map((node) => node.getName()));
    for (const letters of ['FL', 'FR', 'RL', 'RR']) {
      for (const id of [`wheel${letters}`, `wheel${letters}Rim`, `wheel${letters}RimDark`, `brake${letters}`, `caliper${letters}`]) expect(ids.has(id), id).toBe(true);
    }
  });

  it('centres every tyre on its own axle within 1 mm, so the wheels spin without a wobble', () => {
    for (const wheel of WHEEL_SLOTS) {
      const tyre = nodes.find((node) => node.getName() === PAJERO_RULES.tyreNodeIdOf(wheel));
      if (!tyre) throw new Error(`no tyre node for ${wheel}`);
      const [, y, z] = tyre.getTranslation();
      const bounds = getBounds(tyre);
      expect(Math.abs((bounds.min[1] + bounds.max[1]) / 2 - y), `${wheel} height`).toBeLessThan(0.001);
      expect(Math.abs((bounds.min[2] + bounds.max[2]) / 2 - z), `${wheel} length`).toBeLessThan(0.001);
      expect(Math.abs(z - (wheel.startsWith('wheelF') ? PAJERO_WHEEL_Z.front : PAJERO_WHEEL_Z.rear)), `${wheel} axle`).toBeLessThan(0.01);
      expect(Math.sign(tyre.getTranslation()[0]), `${wheel} side`).toBe(wheel.endsWith('L') ? -1 : 1);
    }
  });

  it('stays between 130k and 150k triangles', () => {
    let triangles = 0;
    for (const node of nodes) {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) triangles += (primitive.getIndices()?.getCount() ?? 0) / 3;
    }
    expect(triangles).toBeGreaterThanOrEqual(130_000);
    expect(triangles).toBeLessThanOrEqual(150_000);
  });

  it('carries no badge and no garage: no node or material is named after one', () => {
    const names = [...nodes.map((node) => node.getName()), ...document.getRoot().listMaterials().map((material) => material.getName())];
    for (const name of names) {
      expect(name.toLowerCase()).not.toContain('badge');
      expect(name.toLowerCase()).not.toContain('garage');
    }
  });
});
