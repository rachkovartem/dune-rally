// src/assets/elantraPartRules.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, getBounds, type Node as GltfNode } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { connectedComponents } from './meshCleanup';
import {
  ELANTRA_BADGE_COMPONENTS,
  ELANTRA_HUB,
  ELANTRA_WHEEL_Z,
  classifyElantraPart,
  elantraBadgeReasonOf,
  elantraComponentSlotOf,
  elantraHubOf,
  elantraMaterialSlotFor,
  elantraPlateQuad,
  elantraRawKeyOf,
  type ElantraBox,
  type ElantraPartSample,
} from './elantraPartRules';
import type { WheelSlot } from './carPartRules';
import { carDefinitionFor } from './carCatalog';

// The rules as the renderer receives them, through the car catalog.
const ELANTRA_RULES = carDefinitionFor('elantra').rules;
const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
const TYRE_KEY = 'component#27/wheel/component#3/Geom3D_component#3|[Color B01]3';
const RIM_DARK_KEY = 'component#27/wheel/component#28/Geom3D_component#28|[Color B01]3';
const GRILLE_KEY = 'bump_front/component#26/Geom3D|[Color A05]';
const ROOT = ['Scene', 'SketchUp', 'skp603B'];

const box = (min: [number, number, number], max: [number, number, number]): ElantraBox =>
  ({ min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } });
const tyreAt = (x: number, z: number): ElantraPartSample =>
  ({ rawKey: TYRE_KEY, centre: { x, y: ELANTRA_HUB.y, z }, size: { x: 0.2, y: 0.57, z: 0.57 } });

describe('elantraRawKeyOf — a stable key for one raw primitive (E1)', () => {
  it('folds a mirrored copy onto its original, so both sides get one rule', () => {
    const original = elantraRawKeyOf([...ROOT, 'door_lf_ok', 'Geom3D'], '[Color B04]1');
    const mirrored = elantraRawKeyOf([...ROOT, 'door_lf_ok_1', 'Geom3D'], '[Color B04]1');
    expect(mirrored).toBe(original);
  });

  it('writes the Korean group word in ASCII and marks a primitive with no material', () => {
    expect(elantraRawKeyOf([...ROOT, 'bump_front', '구성 요소#26', 'Geom3D'], null)).toBe('bump_front/component#26/Geom3D|(none)');
  });

  it('throws for a path outside the model root', () => {
    expect(() => elantraRawKeyOf(['Scene', 'Camera'], null)).toThrow('is not below');
  });
});

describe('classifyElantraPart — delete it, or which clean node it joins (E1)', () => {
  it('sends a wheel part at negative x to a left wheel (regression: the model\'s right side is mirrored)', () => {
    const front = classifyElantraPart(tyreAt(-ELANTRA_HUB.x, ELANTRA_WHEEL_Z.front));
    const rear = classifyElantraPart(tyreAt(-ELANTRA_HUB.x, ELANTRA_WHEEL_Z.rear));
    expect(front).toMatchObject({ kind: 'part', cleanId: ELANTRA_RULES.tyreNodeIdOf('wheelFL') });
    expect(rear).toMatchObject({ kind: 'part', cleanId: ELANTRA_RULES.tyreNodeIdOf('wheelRL') });
  });

  it('gives a wheel part its hub, so the node spins about the axle', () => {
    const part = classifyElantraPart(tyreAt(ELANTRA_HUB.x, ELANTRA_WHEEL_Z.rear));
    expect(part).toMatchObject({ kind: 'part', hub: { x: ELANTRA_HUB.x, y: ELANTRA_HUB.y, z: ELANTRA_WHEEL_Z.rear } });
  });

  it('deletes the trunk badge and the model scripts', () => {
    expect(classifyElantraPart({ rawKey: 'component#1/component#6/Geom3D|[Color A05]', centre: { x: 0, y: 1, z: -2 }, size: { x: 0.1, y: 0.1, z: 0.01 } }))
      .toEqual({ kind: 'deleted', reason: 'trunkBadge' });
  });

  it('throws for a raw part nobody has identified, instead of guessing its material', () => {
    expect(() => classifyElantraPart({ rawKey: 'new/Geom3D|[Color Z99]', centre: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } })).toThrow('no role');
  });
});

describe('elantraHubOf — which corner a wheel part belongs to (E1)', () => {
  it('accepts a part 1.9 cm off the hub axis and rejects one 2.1 cm off', () => {
    expect(elantraHubOf({ x: ELANTRA_HUB.x, y: ELANTRA_HUB.y + 0.019, z: ELANTRA_WHEEL_Z.front }).wheel).toBe('wheelFR');
    expect(() => elantraHubOf({ x: ELANTRA_HUB.x, y: ELANTRA_HUB.y + 0.021, z: ELANTRA_WHEEL_Z.front })).toThrow('off the nearest hub axis');
  });

  it('rejects a part far along the axle, inside the body', () => {
    expect(() => elantraHubOf({ x: 0.3, y: ELANTRA_HUB.y, z: ELANTRA_WHEEL_Z.rear })).toThrow('along it');
  });
});

describe('elantraBadgeReasonOf — badges inside a larger part (E1)', () => {
  it('removes a piece that lies fully inside the grille badge box', () => {
    expect(elantraBadgeReasonOf(GRILLE_KEY, box([-0.05, 0.52, 2.23], [0.05, 0.57, 2.27]), null)).toBe('grilleBadge');
  });

  it('keeps a piece that crosses the edge of the badge box by 1 cm', () => {
    expect(elantraBadgeReasonOf(GRILLE_KEY, box([-0.05, 0.52, 2.23], [0.09, 0.57, 2.27]), null)).toBeNull();
  });

  it('removes the cap logo on a left and a right wheel alike, and keeps the cap around it', () => {
    const hubLeft = { x: -ELANTRA_HUB.x, y: ELANTRA_HUB.y, z: ELANTRA_WHEEL_Z.front };
    const hubRight = { x: ELANTRA_HUB.x, y: ELANTRA_HUB.y, z: ELANTRA_WHEEL_Z.front };
    const logoAt = (hub: typeof hubLeft, outward: number): ElantraBox =>
      box([hub.x + outward * 0.085, hub.y - 0.02, hub.z - 0.02], [hub.x + outward * 0.095, hub.y + 0.02, hub.z + 0.02]);
    expect(elantraBadgeReasonOf(RIM_DARK_KEY, logoAt(hubLeft, -1), hubLeft)).toBe('wheelCapBadge');
    expect(elantraBadgeReasonOf(RIM_DARK_KEY, logoAt(hubRight, 1), hubRight)).toBe('wheelCapBadge');
    const cap = box([hubRight.x + 0.07, hubRight.y - 0.05, hubRight.z - 0.05], [hubRight.x + 0.095, hubRight.y + 0.05, hubRight.z + 0.05]);
    expect(elantraBadgeReasonOf(RIM_DARK_KEY, cap, hubRight)).toBeNull();
  });

  it('throws for a wheel rule asked without the part\'s hub', () => {
    expect(() => elantraBadgeReasonOf(RIM_DARK_KEY, box([0, 0, 0], [0.01, 0.01, 0.01]), null)).toThrow('needs the part\'s hub');
  });

  it('never removes anything from a part that has no badge rule', () => {
    expect(elantraBadgeReasonOf('chassis/Geom3D|[Color B04]1', box([-0.05, 0.52, 2.23], [0.05, 0.57, 2.27]), null)).toBeNull();
  });
});

describe('elantraComponentSlotOf — the grille bars are black, the surround chrome (E1)', () => {
  it('moves a piece inside the bar box to black trim and leaves the wider surround chrome', () => {
    expect(elantraComponentSlotOf(GRILLE_KEY, box([-0.45, 0.3, 2.2], [0.45, 0.32, 2.25]))).toBe('blackTrim');
    expect(elantraComponentSlotOf(GRILLE_KEY, box([-0.55, 0.25, 2.1], [0.55, 0.6, 2.29]))).toBeNull();
  });

  it('keeps a bar that pokes 1 cm out of the bar box chrome, so a surround piece is never painted black', () => {
    expect(elantraComponentSlotOf(GRILLE_KEY, box([-0.45, 0.3, 2.2], [0.51, 0.32, 2.25]))).toBeNull();
  });

  it('leaves a part with no rule where it is', () => {
    expect(elantraComponentSlotOf('chassis/Geom3D|[Color B04]1', box([-0.45, 0.3, 2.2], [0.45, 0.32, 2.25]))).toBeNull();
  });
});

describe('the Elantra assembly rules — how the renderer puts the converted car together (E1)', () => {
  it('finds each wheel\'s tyre node again from its id, spinning with the wheel and taking the generated tread', () => {
    for (const wheel of WHEEL_SLOTS) {
      const tyre = ELANTRA_RULES.tyreNodeIdOf(wheel);
      expect(ELANTRA_RULES.wheelCornerOf(tyre)).toBe(wheel);
      expect(ELANTRA_RULES.spinsWithWheel(tyre)).toBe(true);
      expect(ELANTRA_RULES.needsCylindricalUv(tyre)).toBe(true);
    }
  });

  it('keeps body parts on the body: no wheel, no spin, no tread', () => {
    for (const nodeId of ['paint', 'plate', 'glass']) {
      expect(ELANTRA_RULES.wheelCornerOf(nodeId)).toBeNull();
      expect(ELANTRA_RULES.spinsWithWheel(nodeId)).toBe(false);
      expect(ELANTRA_RULES.needsCylindricalUv(nodeId)).toBe(false);
    }
  });

  it('throws for a node id the rules do not know, in every rule', () => {
    expect(() => elantraMaterialSlotFor('badge')).toThrow('no material slot');
    expect(() => ELANTRA_RULES.wheelCornerOf('badge')).toThrow('unknown node id');
    expect(() => ELANTRA_RULES.spinsWithWheel('wheelXX')).toThrow('unknown node id');
  });
});

describe('elantraPlateQuad — the blank rear plate (E1)', () => {
  it('faces backward and a little up, so it shows from behind the car', () => {
    const { positions, indices } = elantraPlateQuad();
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

// The converted GLB is built on the owner's machine and is not in git (like the Forester), so a
// fresh clone skips this contract instead of failing on a missing local asset.
const ELANTRA_GLB = fileURLToPath(new URL('../../public/models/elantra-2016.glb', import.meta.url));
const HAS_GLB = existsSync(ELANTRA_GLB);

describe.skipIf(!HAS_GLB)('public/models/elantra-2016.glb — the converted model contract (E1; skipped when the local GLB is absent: run scripts/convert-elantra.ts)', () => {
  let document: Document;
  let nodes: GltfNode[];

  beforeAll(async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
    document = await io.read(ELANTRA_GLB);
    nodes = document.getRoot().listNodes().filter((node) => node.getMesh() !== null);
  });

  it('has 22 mesh nodes, each one an id the assembly rules know, none twice', () => {
    const ids = nodes.map((node) => node.getName());
    expect(ids).toHaveLength(22);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(() => ELANTRA_RULES.slotFor(id)).not.toThrow();
  });

  it('keeps the UVs on the paint, so the flake map shows (regression: prune once stripped them)', () => {
    const paint = nodes.find((node) => node.getName() === 'paint');
    const primitives = paint?.getMesh()?.listPrimitives() ?? [];
    expect(primitives.length).toBeGreaterThan(0);
    for (const primitive of primitives) expect(primitive.getAttribute('TEXCOORD_0')).not.toBeNull();
  });

  it('centres every tyre node on its hub within 1 mm, so the wheels spin about their axles', () => {
    for (const wheel of WHEEL_SLOTS) {
      const tyre = nodes.find((node) => node.getName() === ELANTRA_RULES.tyreNodeIdOf(wheel));
      if (!tyre) throw new Error(`no tyre node for ${wheel}`);
      const hub = { x: wheel.endsWith('L') ? -ELANTRA_HUB.x : ELANTRA_HUB.x, y: ELANTRA_HUB.y, z: wheel.startsWith('wheelF') ? ELANTRA_WHEEL_Z.front : ELANTRA_WHEEL_Z.rear };
      const [x, y, z] = tyre.getTranslation();
      expect(Math.hypot(x - hub.x, y - hub.y, z - hub.z), `${wheel} node`).toBeLessThan(0.001);
      const bounds = getBounds(tyre);
      const centre = [0, 1, 2].map((axis) => (bounds.min[axis] + bounds.max[axis]) / 2);
      expect(Math.hypot(centre[0] - hub.x, centre[1] - hub.y, centre[2] - hub.z), `${wheel} vertices`).toBeLessThan(0.001);
    }
  });

  it('stays between 110k and 130k triangles', () => {
    let triangles = 0;
    for (const node of nodes) {
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        triangles += (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3;
      }
    }
    expect(triangles).toBeGreaterThanOrEqual(110_000);
    expect(triangles).toBeLessThanOrEqual(130_000);
  });

  it('has no piece left inside the grille badge box: the "H" is gone from the grille', () => {
    const rule = ELANTRA_BADGE_COMPONENTS[GRILLE_KEY];
    for (const node of nodes) {
      const matrix = node.getWorldMatrix();
      const reach = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
        const source = primitive.getAttribute('POSITION');
        const indices = primitive.getIndices();
        if (!source || !indices) throw new Error(`${node.getName()}: a primitive without positions or indices`);
        const positions = new Float32Array(source.getCount() * 3);
        const local = [0, 0, 0];
        for (let vertex = 0; vertex < source.getCount(); vertex++) {
          source.getElement(vertex, local);
          for (let axis = 0; axis < 3; axis++) {
            positions[vertex * 3 + axis] = matrix[axis] * local[0] + matrix[4 + axis] * local[1] + matrix[8 + axis] * local[2] + matrix[12 + axis];
            reach.min[axis] = Math.min(reach.min[axis], positions[vertex * 3 + axis]);
            reach.max[axis] = Math.max(reach.max[axis], positions[vertex * 3 + axis]);
          }
        }
        const split = connectedComponents({ positions, indices: Uint32Array.from({ length: indices.getCount() }, (_unused, index) => indices.getScalar(index)) });
        for (const component of split.components) {
          const inside = [0, 1, 2].every((axis) => {
            const key = (['x', 'y', 'z'] as const)[axis];
            return component.min[axis] >= rule.box.min[key] && component.max[axis] <= rule.box.max[key];
          });
          expect(inside, `${node.getName()} component ${component.id}`).toBe(false);
        }
      }
      // The vertices were read in car space: they fill the node's own bounds.
      const bounds = getBounds(node);
      for (let axis = 0; axis < 3; axis++) {
        expect(Math.abs(reach.min[axis] - bounds.min[axis]), node.getName()).toBeLessThan(0.001);
        expect(Math.abs(reach.max[axis] - bounds.max[axis]), node.getName()).toBeLessThan(0.001);
      }
    }
  });

  it('carries no badge: no node or material is named after one', () => {
    const names = [...nodes.map((node) => node.getName()), ...document.getRoot().listMaterials().map((material) => material.getName())];
    for (const name of names) expect(name.toLowerCase()).not.toContain('badge');
  });
});
