// src/world/propColliders.ts
// The collider box of every solid prop model, and where a placed prop's box stands in the world.
// Pure data, so the client and the server build the same boulders without loading a GLB.
import type { PolyPropId } from './propIds';

/** A model's bounds at scale 1, in its own frame: half sizes and the centre of the box. */
export interface PropColliderShape {
  halfX: number;
  halfY: number;
  halfZ: number;
  centreX: number;
  centreY: number;
  centreZ: number;
}

/**
 * Bounds of `public/props/*.glb` (node transform applied, as three's Box3 reads them). `null` means
 * the model never stops a car: the bush folds over and the stones are pebbles.
 */
export const PROP_COLLIDER_SHAPES: Readonly<Record<PolyPropId, PropColliderShape | null>> = {
  namaqualand_boulder_02: { halfX: 1.2661, halfY: 0.4402, halfZ: 0.6164, centreX: 0.0821, centreY: 0.3807, centreZ: 0.0091 },
  namaqualand_boulder_03: { halfX: 1.2019, halfY: 0.7365, halfZ: 1.5326, centreX: 0.1505, centreY: 0.7218, centreZ: 0.1431 },
  namaqualand_boulder_05: { halfX: 0.682, halfY: 0.2681, halfZ: 0.374, centreX: 0.0469, centreY: 0.2583, centreZ: -0.024 },
  dead_tree_trunk_02: { halfX: 2.0248, halfY: 0.5268, halfZ: 0.5263, centreX: 0.1021, centreY: 0.1997, centreZ: 0.0274 },
  namaqualand_stones_01: null,
  wild_rooibos_bush: null,
};

/** A box in world space, turned `yaw` about +y. */
export interface PropColliderBox {
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}

export interface PlacedModel {
  modelId: PolyPropId;
  x: number;
  z: number;
  groundY: number;
  yaw: number;
  scale: number;
}

/** The box of a placed model, turned exactly as the drawn model is (three's rotation.y = yaw); null when it is not solid. */
export function propColliderBox(placed: PlacedModel): PropColliderBox | null {
  const shape = PROP_COLLIDER_SHAPES[placed.modelId];
  if (!shape) return null;
  const { scale, yaw } = placed;
  const centreX = shape.centreX * scale;
  const centreZ = shape.centreZ * scale;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: placed.x + centreX * cos + centreZ * sin,
    y: placed.groundY + shape.centreY * scale,
    z: placed.z - centreX * sin + centreZ * cos,
    yaw,
    halfX: shape.halfX * scale,
    halfY: shape.halfY * scale,
    halfZ: shape.halfZ * scale,
  };
}

/** Radius around the placement point that a model covers on the ground at `scale`; 0 when it is not solid. */
export function propFootprintRadius(modelId: PolyPropId, scale: number): number {
  const shape = PROP_COLLIDER_SHAPES[modelId];
  if (!shape) return 0;
  return (Math.hypot(shape.centreX, shape.centreZ) + Math.hypot(shape.halfX, shape.halfZ)) * scale;
}

/** Height of a model's box at `scale`. */
export function propHeight(modelId: PolyPropId, scale: number): number {
  const shape = PROP_COLLIDER_SHAPES[modelId];
  return shape ? 2 * shape.halfY * scale : 0;
}
