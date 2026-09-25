// src/world/noise.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import * as W from './worldDef';

export type Height2D = (x: number, z: number) => number;

/**
 * The authored unique world's height field. The macro shape (rolling basin, border slope, mesa,
 * dune sea, spawn knoll) is hand-defined in worldDef; a fixed-seed micro-noise adds subtle surface
 * texture; roads and the town plaza are graded to the local average ground level, so a flat never
 * sits below its surroundings as a hole. The seed argument is ignored for shape — the world is the
 * SAME unique place for everyone — but the signature is kept so the whole terrain → trimesh →
 * physics → multiplayer pipeline is unchanged. Only the lake carve goes below the water level.
 */
export function createHeightField(_seed: number): Height2D {
  // Fixed seed → identical micro-detail on every client and the server.
  const micro = createNoise2D(mulberry32(0x5eed1234));

  const base = (x: number, z: number): number => {
    let h = micro(x * 0.025, z * 0.025) * 0.6;
    h += W.rollingGroundHeight(x, z);
    h += W.mesaHeight(x, z);
    h += W.duneHeight(x, z);
    const cliff = W.cliffHeight(x, z);
    return cliff > h ? cliff : h;
  };

  const ROAD_INFL = W.ROAD_HALF + W.ROAD_SHOULDER + W.ROAD_RAMP;
  const PAD_INFL = W.TOWN.plaza + W.TOWN.skirt;
  const plazaLevel = W.groundLevel(W.TOWN.x, W.TOWN.z);

  return (x: number, z: number): number => {
    let h = base(x, z);

    // Town plaza: flatten to the ground level at the town centre with a smooth skirt.
    const td = W.townDist(x, z);
    if (td < PAD_INFL) {
      h = W.lerp(h, plazaLevel, 1 - W.smoothstep(W.TOWN.plaza, PAD_INFL, td));
    }

    // Roads: grade toward the authored height above the ground level at the closest centre-line
    // point (so the cross-section stays level), with a ramped shoulder so the corridor is a flat
    // drivable strip with gentle edges (no vertical cut).
    const rd = W.nearestRoad(x, z, ROAD_INFL);
    if (rd && rd.dist < ROAD_INFL) {
      const roadH = W.groundLevel(rd.x, rd.z) + W.lerp(rd.ya, rd.yb, rd.t);
      h = W.lerp(h, roadH, 1 - W.smoothstep(W.ROAD_HALF, ROAD_INFL, rd.dist));
    }

    // Lake: carve a basin toward lakeDepthAt near the centre, blending back to natural terrain
    // by the outer feather — same late-blend shape as the town plaza and road grading above.
    const li = W.lakeInfluence(x, z);
    if (li > 0) h = W.lerp(h, W.lakeDepthAt(x, z), li);

    return h;
  };
}
