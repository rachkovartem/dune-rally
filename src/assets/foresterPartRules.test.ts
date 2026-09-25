// src/assets/foresterPartRules.test.ts
import { describe, it, expect } from 'vitest';
import {
  FORESTER_ASSEMBLY_RULES,
  FORESTER_DELETED_NODES,
  FORESTER_HUB,
  FORESTER_WHEEL_Z,
  classifyForesterNode,
  foresterMaterialSlotFor,
  type ForesterNodeSample,
  type ForesterVector,
} from './foresterPartRules';
import type { WheelSlot } from './carPartRules';

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

function sample(overrides: Partial<ForesterNodeSample> & { centre?: ForesterVector }): ForesterNodeSample {
  return {
    rawName: 'desirefx.me_500',
    materialName: 'body',
    centre: { x: 0, y: 1, z: 0 },
    size: { x: 1, y: 1, z: 1 },
    ...overrides,
  };
}

/** A tyre-sized part at a wheel corner of the raw model. */
const cornerSample = (x: number, z: number, materialName = 'tire_mat4', size = 0.7): ForesterNodeSample =>
  sample({ materialName, centre: { x, y: FORESTER_HUB.y, z }, size: { x: size * 0.4, y: size, z: size } });

describe('classifyForesterNode — deletions (R87, R88)', () => {
  it.each(Object.keys(FORESTER_DELETED_NODES))('deletes the badge node "%s"', (rawName) => {
    expect(classifyForesterNode(sample({ rawName })).kind).toBe('deleted');
  });

  it('deletes every blue-material node wherever it sits and whatever its size (the brand oval)', () => {
    expect(classifyForesterNode(sample({ materialName: 'blue' }))).toEqual({ kind: 'deleted', reason: 'blueMaterial' });
    expect(classifyForesterNode(cornerSample(0.78, FORESTER_WHEEL_Z.front, 'blue'))).toEqual({ kind: 'deleted', reason: 'blueMaterial' });
  });
});

describe('classifyForesterNode — wheel corners (R89–R92)', () => {
  it('names the corners after the rig pivots: negative x is the left wheel', () => {
    // Deviation from matrix R89 recorded in the C1a journal entry: the game rig puts its left
    // wheels at negative x, so a part must be named after the pivot on its own side.
    const left = classifyForesterNode(cornerSample(-0.78, 1.345));
    const right = classifyForesterNode(cornerSample(0.78, 1.345));
    expect(left).toMatchObject({ kind: 'part', cleanId: 'wheelFL', slot: 'rubber' });
    expect(right).toMatchObject({ kind: 'part', cleanId: 'wheelFR', slot: 'rubber' });
  });

  it('centres a rolling part on its own hub, on its own side of the car', () => {
    const right = classifyForesterNode(cornerSample(0.78, 1.345));
    const left = classifyForesterNode(cornerSample(-0.78, 1.345));
    expect(right).toMatchObject({ hub: { x: FORESTER_HUB.x, y: FORESTER_HUB.y, z: FORESTER_WHEEL_Z.front } });
    expect(left).toMatchObject({ hub: { x: -FORESTER_HUB.x, y: FORESTER_HUB.y, z: FORESTER_WHEEL_Z.front } });
  });

  it('puts a part at the rear axle on a rear corner, centred on the rear hub', () => {
    expect(classifyForesterNode(cornerSample(-0.78, -1.315))).toMatchObject({ cleanId: 'wheelRL', hub: { z: FORESTER_WHEEL_Z.rear } });
    expect(classifyForesterNode(cornerSample(0.78, -1.315))).toMatchObject({ cleanId: 'wheelRR' });
  });

  it('does not treat a part exactly at |x| = 0.95 as a wheel part: it falls through to its material', () => {
    expect(classifyForesterNode(cornerSample(0.95, 1.345, 'black'))).toMatchObject({ cleanId: 'blackTrim', hub: null });
    expect(classifyForesterNode(cornerSample(0.9499, 1.345, 'black', 0.04))).toMatchObject({ cleanId: 'wheelFRRim' });
  });

  it('does not treat a big part at a wheel corner as a wheel part (a fender, not a tyre)', () => {
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'body', 0.75))).toMatchObject({ cleanId: 'paint', hub: null });
  });

  it('does not treat a part far from both axles as a wheel part', () => {
    expect(classifyForesterNode(cornerSample(0.78, 0, 'body'))).toMatchObject({ cleanId: 'paint' });
  });

  it('keeps a brake disc at its corner but fixed to the hub (no hub centre, it does not roll)', () => {
    expect(classifyForesterNode(cornerSample(-0.78, -1.315, 'brakes1', 0.3))).toMatchObject({
      kind: 'part', cleanId: 'brakeRL', slot: 'brake', hub: null,
    });
  });

  it('tells the rim pieces and the caliper apart by material and size', () => {
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'black_m', 0.5))).toMatchObject({ cleanId: 'wheelFRRimDark', slot: 'rimDark' });
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'silver', 0.5))).toMatchObject({ cleanId: 'wheelFRRim', slot: 'rim' });
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'silver_d', 0.149))).toMatchObject({ cleanId: 'wheelFRRim' });
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'silver_d', 0.15))).toMatchObject({ cleanId: 'caliperFR', hub: null });
    expect(classifyForesterNode(cornerSample(0.78, 1.345, 'gum', 0.2))).toMatchObject({ cleanId: 'caliperFR', slot: 'blackTrim' });
  });
});

describe('classifyForesterNode — body parts (R93–R95)', () => {
  it('draws the exhaust tip as chrome whatever its source material', () => {
    expect(classifyForesterNode(sample({ rawName: 'desirefx.me_048', materialName: 'black' }))).toMatchObject({ cleanId: 'chrome', slot: 'chrome' });
  });

  it('turns only the wide chrome part at the headlight line into the headlight', () => {
    const atHeadlights = (width: number): ForesterNodeSample =>
      sample({ materialName: 'chrome', centre: { x: 0, y: 0.8, z: 1.921 }, size: { x: width, y: 0.2, z: 0.2 } });
    expect(classifyForesterNode(atHeadlights(1.7))).toMatchObject({ cleanId: 'headlight', slot: 'headlight' });
    expect(classifyForesterNode(atHeadlights(1.5))).toMatchObject({ cleanId: 'chrome', slot: 'chrome' });
    expect(classifyForesterNode(atHeadlights(1.6))).toMatchObject({ cleanId: 'chrome' });
  });

  it('does not turn a wide chrome part away from the headlight line into the headlight', () => {
    const bumperTrim = sample({ materialName: 'chrome', centre: { x: 0, y: 0.5, z: -2.1 }, size: { x: 1.8, y: 0.1, z: 0.1 } });
    expect(classifyForesterNode(bumperTrim)).toMatchObject({ cleanId: 'chrome' });
  });

  it('gives a body node the slot of its source material', () => {
    expect(classifyForesterNode(sample({ materialName: 'd_glass' }))).toMatchObject({ cleanId: 'glass', hub: null });
    expect(classifyForesterNode(sample({ materialName: 'red' }))).toMatchObject({ cleanId: 'taillight' });
  });

  it.each(['tire_mat4', 'brakes1', 'unknown_material'])(
    'throws for a body node with the material "%s" that no rule covers',
    (materialName) => {
      expect(() => classifyForesterNode(sample({ materialName }))).toThrow(`no slot for material "${materialName}"`);
    },
  );
});

describe('foresterMaterialSlotFor — every clean id the converter writes (R96, R97)', () => {
  it.each(WHEEL_SLOTS)('knows every part of the %s corner', (corner) => {
    const letters = corner.slice('wheel'.length);
    expect(foresterMaterialSlotFor(corner)).toBe('rubber');
    expect(foresterMaterialSlotFor(`${corner}Rim`)).toBe('rim');
    expect(foresterMaterialSlotFor(`${corner}RimDark`)).toBe('rimDark');
    expect(foresterMaterialSlotFor(`brake${letters}`)).toBe('brake');
    expect(foresterMaterialSlotFor(`caliper${letters}`)).toBe('blackTrim');
  });

  it('agrees with the slot the classifier gave the node when it named it', () => {
    const samples = [
      cornerSample(-0.78, 1.345), cornerSample(0.78, -1.315, 'brakes1', 0.3), cornerSample(0.78, 1.345, 'gum', 0.2),
      sample({ materialName: 'plate' }), sample({ materialName: 'orange' }), sample({ materialName: 'interior' }),
    ];
    for (const node of samples) {
      const decided = classifyForesterNode(node);
      if (decided.kind !== 'part') throw new Error('expected a part');
      expect(foresterMaterialSlotFor(decided.cleanId)).toBe(decided.slot);
    }
  });

  it.each(['', 'wheelFLTyre', 'brakeXX', 'body'])('throws for the unknown id "%s"', (nodeId) => {
    expect(() => foresterMaterialSlotFor(nodeId)).toThrow('no material slot documented');
  });
});

describe('FORESTER_ASSEMBLY_RULES (R98–R100)', () => {
  it('keeps a brake on its corner without rolling it', () => {
    expect(FORESTER_ASSEMBLY_RULES.wheelCornerOf('brakeRL')).toBe('wheelRL');
    expect(FORESTER_ASSEMBLY_RULES.spinsWithWheel('brakeRL')).toBe(false);
    expect(FORESTER_ASSEMBLY_RULES.spinsWithWheel('caliperFR')).toBe(false);
  });

  it('rolls the tyre and both rim layers', () => {
    for (const nodeId of ['wheelRL', 'wheelRLRim', 'wheelRLRimDark']) {
      expect(FORESTER_ASSEMBLY_RULES.wheelCornerOf(nodeId)).toBe('wheelRL');
      expect(FORESTER_ASSEMBLY_RULES.spinsWithWheel(nodeId)).toBe(true);
    }
  });

  it('keeps body panels off the wheels', () => {
    expect(FORESTER_ASSEMBLY_RULES.wheelCornerOf('paint')).toBeNull();
    expect(FORESTER_ASSEMBLY_RULES.spinsWithWheel('paint')).toBe(false);
  });

  it('never asks for a generated tread UV: the model ships its own tyre UV', () => {
    for (const nodeId of ['wheelFL', 'paint', 'brakeRR']) expect(FORESTER_ASSEMBLY_RULES.needsCylindricalUv(nodeId)).toBe(false);
  });

  it.each(WHEEL_SLOTS)('names the %s tyre node as that corner\'s hub', (slot) => {
    expect(FORESTER_ASSEMBLY_RULES.tyreNodeIdOf(slot)).toBe(slot);
  });

  it('throws for a node id the converter never writes', () => {
    expect(() => FORESTER_ASSEMBLY_RULES.wheelCornerOf('desirefx.me_184')).toThrow('unknown node id');
    expect(() => FORESTER_ASSEMBLY_RULES.needsCylindricalUv('mystery')).toThrow('unknown node id');
  });
});
