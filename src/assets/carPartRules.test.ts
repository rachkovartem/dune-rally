// src/assets/carPartRules.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CAR_NODE_RENAMES,
  GLASS_SPLIT_NODES,
  PAJERO_ASSEMBLY_RULES,
  WHEEL_FRONT_REAR_BOUNDARY_Z,
  WHEEL_RIM_RADIUS_RATIO,
  classifyCarTriangle,
  classifyWheelVertex,
  materialSlotFor,
  wheelSlotFor,
  type WheelSlot,
} from './carPartRules';

const WHEEL_SLOTS: readonly WheelSlot[] = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];

describe('classifyCarTriangle — glass vs paint on the Pajero body (R27–R30)', () => {
  it('paints every triangle below the belt line, whatever its normal', () => {
    expect(classifyCarTriangle({ centroidY: 0.5, centroidZ: 0, normalY: 0 })).toBe('paint');
    expect(classifyCarTriangle({ centroidY: 0.5, centroidZ: -3, normalY: 1 })).toBe('paint');
  });

  it('makes a side-facing triangle between the belt and the roof line glass (a side window)', () => {
    expect(classifyCarTriangle({ centroidY: 0.85, centroidZ: 0, normalY: 0.1 })).toBe('glass');
  });

  it('keeps the roof paint and the windscreen glass above the roof line, by the normal', () => {
    expect(classifyCarTriangle({ centroidY: 1.2, centroidZ: 0, normalY: 0.95 })).toBe('paint');
    expect(classifyCarTriangle({ centroidY: 1.2, centroidZ: 0, normalY: -0.9 })).toBe('paint');
    expect(classifyCarTriangle({ centroidY: 1.2, centroidZ: 0, normalY: 0.4 })).toBe('glass');
  });

  it('keeps a triangle exactly on the belt line as paint', () => {
    expect(classifyCarTriangle({ centroidY: 0.74, centroidZ: 0, normalY: 0 })).toBe('paint');
  });

  it('uses the higher rear belt only behind the rear boundary, and the front belt exactly on it', () => {
    // The tailgate glass starts higher than the door glass; the switch must not flip back and forth.
    expect(classifyCarTriangle({ centroidY: 0.8, centroidZ: -2.5, normalY: 0 })).toBe('glass');
    expect(classifyCarTriangle({ centroidY: 0.8, centroidZ: -2.5001, normalY: 0 })).toBe('paint');
    expect(classifyCarTriangle({ centroidY: 0.9, centroidZ: -2.5001, normalY: 0 })).toBe('glass');
  });
});

describe('wheelSlotFor — raw wheel translation to rig corner (R31, R32)', () => {
  it('maps the four measured Pajero wheel positions to FL, FR, RL, RR (left = negative x)', () => {
    expect(wheelSlotFor({ x: -0.46, z: -0.487 })).toBe('wheelFL');
    expect(wheelSlotFor({ x: 0.46, z: -0.487 })).toBe('wheelFR');
    expect(wheelSlotFor({ x: -0.46, z: -2.172 })).toBe('wheelRL');
    expect(wheelSlotFor({ x: 0.46, z: -2.172 })).toBe('wheelRR');
  });

  it('counts a wheel exactly on the front/rear boundary as a rear wheel', () => {
    expect(wheelSlotFor({ x: -0.46, z: WHEEL_FRONT_REAR_BOUNDARY_Z })).toBe('wheelRL');
  });

  it('throws for a wheel on the centreline: it cannot tell left from right', () => {
    expect(() => wheelSlotFor({ x: 0, z: -0.5 })).toThrow('cannot tell left from right');
  });
});

describe('classifyWheelVertex — rim vs rubber (R35)', () => {
  const tyreRadius = 0.5;
  const boundary = tyreRadius * WHEEL_RIM_RADIUS_RATIO;

  it('splits exactly at the rim radius: inside is rim, on and outside is rubber', () => {
    expect(classifyWheelVertex(boundary - 1e-9, tyreRadius)).toBe('rim');
    expect(classifyWheelVertex(boundary, tyreRadius)).toBe('rubber');
    expect(classifyWheelVertex(boundary + 1e-9, tyreRadius)).toBe('rubber');
  });

  it('puts the hub centre in the rim and the tread in the rubber', () => {
    expect(classifyWheelVertex(0, tyreRadius)).toBe('rim');
    expect(classifyWheelVertex(tyreRadius, tyreRadius)).toBe('rubber');
  });
});

describe('materialSlotFor — every node the Pajero pipeline produces has a slot (R33, R34)', () => {
  const pipelineBodyIds = [
    ...Object.values(CAR_NODE_RENAMES),
    ...GLASS_SPLIT_NODES.map((id) => `${id}Glass`),
  ];

  it.each(pipelineBodyIds)('knows the pipeline body id "%s"', (nodeId) => {
    expect(() => materialSlotFor(nodeId)).not.toThrow();
  });

  it.each(GLASS_SPLIT_NODES.map((id) => [id, `${id}Glass`]))('draws the glass half of "%s" as glass and its body half not as glass', (id, glassId) => {
    expect(materialSlotFor(glassId)).toBe('glass');
    expect(materialSlotFor(id)).not.toBe('glass');
  });

  it('draws every tyre as rubber and every rim as rim', () => {
    for (const slot of WHEEL_SLOTS) {
      expect(materialSlotFor(slot)).toBe('rubber');
      expect(materialSlotFor(`${slot}Rim`)).toBe('rim');
    }
  });

  it.each(['', 'Grill', 'bodyshell', 'wheelFLRimDark'])('throws for the unknown id "%s" instead of picking a default slot', (nodeId) => {
    expect(() => materialSlotFor(nodeId)).toThrow('no material slot documented');
  });
});

describe('PAJERO_ASSEMBLY_RULES (R73, R74)', () => {
  it.each(WHEEL_SLOTS)('puts the %s tyre and its rim on that corner, both rolling', (slot) => {
    expect(PAJERO_ASSEMBLY_RULES.wheelCornerOf(slot)).toBe(slot);
    expect(PAJERO_ASSEMBLY_RULES.wheelCornerOf(`${slot}Rim`)).toBe(slot);
    expect(PAJERO_ASSEMBLY_RULES.spinsWithWheel(slot)).toBe(true);
    expect(PAJERO_ASSEMBLY_RULES.spinsWithWheel(`${slot}Rim`)).toBe(true);
    expect(PAJERO_ASSEMBLY_RULES.tyreNodeIdOf(slot)).toBe(slot);
  });

  it('keeps body nodes off the wheels and gives the generated tread UV to the tyres only', () => {
    expect(PAJERO_ASSEMBLY_RULES.wheelCornerOf('hood')).toBeNull();
    expect(PAJERO_ASSEMBLY_RULES.spinsWithWheel('hood')).toBe(false);
    expect(PAJERO_ASSEMBLY_RULES.needsCylindricalUv('wheelFL')).toBe(true);
    expect(PAJERO_ASSEMBLY_RULES.needsCylindricalUv('wheelFLRim')).toBe(false);
    expect(PAJERO_ASSEMBLY_RULES.needsCylindricalUv('hood')).toBe(false);
  });

  it('throws for an unknown node id', () => {
    expect(() => PAJERO_ASSEMBLY_RULES.slotFor('badge')).toThrow();
  });
});

describe('the shipped Pajero model matches its rules (contract with public/models/pajero-sport.glb)', () => {
  /** Mesh node names from the GLB's JSON chunk. */
  function meshNodeNames(path: string): string[] {
    const file = readFileSync(path);
    const jsonLength = file.readUInt32LE(12);
    const json: unknown = JSON.parse(file.subarray(20, 20 + jsonLength).toString('utf8'));
    if (typeof json !== 'object' || json === null || !('nodes' in json) || !Array.isArray(json.nodes)) {
      throw new Error(`${path}: no node list in the glTF JSON`);
    }
    return json.nodes.flatMap((node: unknown) =>
      typeof node === 'object' && node !== null && 'mesh' in node && 'name' in node && typeof node.name === 'string' ? [node.name] : []);
  }
  const names = meshNodeNames(new URL('../../public/models/pajero-sport.glb', import.meta.url).pathname);

  it('gives every mesh in the file a material slot', () => {
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(() => PAJERO_ASSEMBLY_RULES.slotFor(name)).not.toThrow();
  });

  it('has the tyre node of every corner the rig mounts', () => {
    for (const slot of WHEEL_SLOTS) expect(names).toContain(PAJERO_ASSEMBLY_RULES.tyreNodeIdOf(slot));
  });
});
