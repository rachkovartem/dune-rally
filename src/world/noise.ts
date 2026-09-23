// src/world/noise.ts
import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from './rng';
import * as W from './worldDef';

export type Height2D = (x: number, z: number) => number;

/**
 * The authored unique world's height field. The macro shape (basin, cliff ring, mesa, dune sea) is
 * hand-defined in worldDef; a fixed-seed micro-noise adds subtle surface texture; roads and the town
 * plaza flatten the ground toward their authored target heights. The seed argument is ignored for
 * shape — the world is the SAME unique place for everyone — but the signature is kept so the whole
 * terrain → trimesh → physics → multiplayer pipeline is unchanged. Heights stay bounded to roughly
 * [-1, BORDER_HEIGHT]; the only point above the basin floor that the car cannot climb is the cliff
 * ring, which is the world boundary.
 */
export function createHeightField(_seed: number): Height2D {
  // Fixed seed → identical micro-detail on every client and the server.
  const micro = createNoise2D(mulberry32(0x5eed1234));

  const base = (x: number, z: number): number => {
    let h = micro(x * 0.025, z * 0.025) * 0.6;
    h += W.mesaHeight(x, z);
    h += W.duneHeight(x, z);
    const cliff = W.cliffHeight(x, z);
    return cliff > h ? cliff : h;
  };

  const ROAD_INFL = W.ROAD_HALF + W.ROAD_SHOULDER + W.ROAD_RAMP;
  const PAD_INFL = W.TOWN.plaza + W.TOWN.skirt;

  return (x: number, z: number): number => {
    let h = base(x, z);

    // Town plaza: flatten to the plaza height (0) with a smooth skirt.
    const td = W.townDist(x, z);
    if (td < PAD_INFL) {
      h = W.lerp(h, 0, 1 - W.smoothstep(W.TOWN.plaza, PAD_INFL, td));
    }

    // Roads: grade toward the line between the nearest segment's authored endpoint heights, with a
    // ramped shoulder so the corridor is a flat drivable strip with gentle edges (no vertical cut).
    const rd = W.nearestRoad(x, z);
    if (rd && rd.dist < ROAD_INFL) {
      const roadH = W.lerp(rd.ya, rd.yb, rd.t);
      h = W.lerp(h, roadH, 1 - W.smoothstep(W.ROAD_HALF, ROAD_INFL, rd.dist));
    }

    return h;
  };
}
