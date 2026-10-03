// src/render/tbilisi/tbilisiLandmarks.ts
// Photorealistic 3D architectural landmarks and authentic urban environment for Tbilisi:
// Metekhi Bridge, Meidan / Old Tbilisi, Narikala Mountain Ridge & Fortress, Kartlis Deda,
// Aerial Cable Car, Metekhi Church & Cliff, and Europe Square.
import * as THREE from 'three';
import satOrthophotoUrl from '../../assets/tbilisi/europe_square_sat.webp';
import asphaltUrl from '../../assets/tbilisi/tbilisi_asphalt.webp';
import cobbleUrl from '../../assets/tbilisi/tbilisi_cobble.webp';
import cliffRockUrl from '../../assets/tbilisi/tbilisi_cliff_rock.webp';
import tuffWallUrl from '../../assets/tbilisi/tbilisi_tuff_wall.webp';
import churchFacadeUrl from '../../assets/tbilisi/tbilisi_church_facade.webp';
import churchDrumUrl from '../../assets/tbilisi/tbilisi_church_drum.webp';
import churchRoofUrl from '../../assets/tbilisi/tbilisi_church_roof.webp';
import gorgasaliStatueUrl from '../../assets/tbilisi/tbilisi_gorgasali_statue.webp';
import balconyFacadeUrl from '../../assets/tbilisi/tbilisi_balcony_facade.webp';
import houseFacade2Url from '../../assets/tbilisi/tbilisi_house_facade2.webp';
import roofTilesUrl from '../../assets/tbilisi/tbilisi_roof_tiles.webp';

import {
  TBILISI_CENTER, TBILISI_ORTHO_BOUNDS, TBILISI_METEKHI_BRIDGE,
  TBILISI_METEKHI_CHURCH, TBILISI_GORGASALI_STATUE,
  TBILISI_KURA_LINE, TBILISI_KURA_RIVER,
  TBILISI_ROUNDABOUT, TBILISI_METEKHI_CLIFF,
  TBILISI_NARIKALA, TBILISI_MEIDAN,
} from '../../world/tbilisi/tbilisiDef';

// Reusable unit geometry
const G_BOX = new THREE.BoxGeometry(1, 1, 1);
const G_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const G_CONE = new THREE.ConeGeometry(0.5, 1, 16);

// ── Texture Loader & Helpers ──────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();

function loadRepeatTexture(url: string, repeatX = 1, repeatY = 1): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function loadClampedTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ── Photographic PBR Materials ────────────────────────────────────────
const M_ASPHALT = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(asphaltUrl, 16, 16),
  roughness: 0.85,
  metalness: 0.05,
});

const M_COBBLE = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(cobbleUrl, 10, 10),
  roughness: 0.78,
  metalness: 0.05,
});

const M_CLIFF_ROCK = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(cliffRockUrl, 4, 3),
  roughness: 0.92,
  metalness: 0.02,
});

const M_TUFF_WALL = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(tuffWallUrl, 3, 2),
  roughness: 0.86,
  metalness: 0.04,
});

const M_CHURCH_FACADE = new THREE.MeshStandardMaterial({
  map: loadClampedTexture(churchFacadeUrl),
  roughness: 0.86,
  metalness: 0.04,
});

const M_CHURCH_DRUM = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(churchDrumUrl, 1, 1),
  roughness: 0.85,
  metalness: 0.04,
});

const M_CHURCH_ROOF = new THREE.MeshStandardMaterial({
  map: loadClampedTexture(churchRoofUrl),
  roughness: 0.82,
  metalness: 0.05,
});

const M_ROOF_TILES = new THREE.MeshStandardMaterial({
  map: loadRepeatTexture(roofTilesUrl, 4, 4),
  roughness: 0.82,
  metalness: 0.05,
});

const M_BALCONY_FACADE = new THREE.MeshStandardMaterial({
  map: loadClampedTexture(balconyFacadeUrl),
  roughness: 0.75,
  metalness: 0.08,
});

const M_HOUSE_FACADE = new THREE.MeshStandardMaterial({
  map: loadClampedTexture(houseFacade2Url),
  roughness: 0.82,
  metalness: 0.05,
});

const M_GORGASALI_CUTOUT = new THREE.MeshStandardMaterial({
  map: loadClampedTexture(gorgasaliStatueUrl),
  transparent: true,
  alphaTest: 0.2,
  side: THREE.DoubleSide,
  roughness: 0.4,
  metalness: 0.65,
});

const M_GOLD_CROSS = new THREE.MeshStandardMaterial({
  color: 0xffd700,
  roughness: 0.22,
  metalness: 0.92,
});

const M_SILVER_STATUE = new THREE.MeshStandardMaterial({
  color: 0xd8dde2,
  roughness: 0.35,
  metalness: 0.85,
});

const M_BRONZE_STATUE = new THREE.MeshStandardMaterial({
  color: 0x2b3832,
  roughness: 0.38,
  metalness: 0.75,
});

const M_DARK_BASALT = new THREE.MeshStandardMaterial({
  color: 0x282725,
  roughness: 0.78,
  metalness: 0.1,
});

const M_WHITE_MARKING = new THREE.MeshStandardMaterial({
  color: 0xf0f0f0,
  roughness: 0.45,
  metalness: 0.05,
});

const M_CONCRETE_CURB = new THREE.MeshStandardMaterial({
  color: 0x9a9892,
  roughness: 0.88,
  metalness: 0.05,
});

const M_STEEL_STRUCTURE = new THREE.MeshStandardMaterial({
  color: 0x22272a,
  roughness: 0.4,
  metalness: 0.8,
});

const M_LAMP_GLOW = new THREE.MeshBasicMaterial({
  color: 0xffe6a3,
});

const M_GLASS_TINTED = new THREE.MeshStandardMaterial({
  color: 0x243338,
  transparent: true,
  opacity: 0.75,
  roughness: 0.1,
  metalness: 0.8,
});

const M_KURA_WATER = new THREE.MeshStandardMaterial({
  color: 0x1f5647,
  roughness: 0.12,
  metalness: 0.35,
  transparent: true,
  opacity: 0.92,
});

const M_CYPRESS_FOLIAGE = new THREE.MeshStandardMaterial({
  color: 0x1a3a22,
  roughness: 0.88,
  metalness: 0.02,
});

const M_PLANE_TREE_FOLIAGE = new THREE.MeshStandardMaterial({
  color: 0x3d6627,
  roughness: 0.85,
  metalness: 0.02,
});

const M_TREE_TRUNK = new THREE.MeshStandardMaterial({
  color: 0x483a2b,
  roughness: 0.92,
  metalness: 0.02,
});

const M_LAWN_GRASS = new THREE.MeshStandardMaterial({
  color: 0x47782b,
  roughness: 0.9,
  metalness: 0.02,
});

const M_FLOWER_RED = new THREE.MeshStandardMaterial({
  color: 0xbf211e,
  roughness: 0.8,
});

const M_FLOWER_YELLOW = new THREE.MeshStandardMaterial({
  color: 0xf5b700,
  roughness: 0.8,
});

// Automotive Car Paint Materials for ambient bridge cars
const M_CAR_GREY = new THREE.MeshStandardMaterial({ color: 0x3d4348, roughness: 0.22, metalness: 0.82 });
const M_CAR_SILVER = new THREE.MeshStandardMaterial({ color: 0xc4c7cc, roughness: 0.25, metalness: 0.78 });
const M_CAR_BLUE = new THREE.MeshStandardMaterial({ color: 0x1f3c64, roughness: 0.22, metalness: 0.85 });
const M_CAR_TYRE = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.92, metalness: 0.02 });
const M_CAR_WHEEL_RIM = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.25, metalness: 0.85 });

/**
 * 1. Satellite Orthophoto Ground Overlay
 * Drapes the high-resolution aerial imagery over the Europe Square district as the base layer.
 */
function createOrthophotoGround(heightAt: (x: number, z: number) => number): THREE.Mesh {
  const w = TBILISI_ORTHO_BOUNDS.width;
  const h = TBILISI_ORTHO_BOUNDS.height;
  const segs = 72;
  const geom = new THREE.PlaneGeometry(w, h, segs, segs);
  geom.rotateX(-Math.PI / 2);

  const pos = geom.attributes.position;
  const cx = TBILISI_CENTER.x;
  const cz = TBILISI_CENTER.z;

  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const wx = cx + lx;
    const wz = cz + lz;
    const groundY = heightAt(wx, wz);
    pos.setY(i, groundY + 0.01);
  }
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const texture = textureLoader.load(satOrthophotoUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 2. Metekhi Bridge (Мост Метехи) — Exact match to Google Street View photo.
 * Spans North-South (Z: 610 -> 490) across the Kura gorge.
 * Features:
 * - 4 traffic lanes on asphalt deck flush with terrain collider (14.50m) so tyres sit perfectly.
 * - Granite cobblestone transition strip on the right side of the bridge.
 * - White road markings: directional arrows, dashed lane lines, solid white line.
 * - Left side: solid cut-stone historical parapet with vintage arched streetlamps.
 * - Right side: ornate cast-iron railing with vintage arched streetlamps.
 * - Raised granite curbs and cobblestone sidewalks on both sides.
 * - Ambient realistic cars parked / driving on the bridge shoulders.
 */
function createMetekhiBridge(): THREE.Group {
  const bridge = new THREE.Group();
  const start = TBILISI_METEKHI_BRIDGE.start;
  const end = TBILISI_METEKHI_BRIDGE.end;
  const len = Math.abs(start.z - end.z); // 120m
  const midZ = (start.z + end.z) / 2;    // 550m
  const y = TBILISI_METEKHI_BRIDGE.deckElevation; // 14.50m
  const w = TBILISI_METEKHI_BRIDGE.width; // 18.0m

  // ── Road Asphalt Deck (Flush at y + 0.005 to prevent tyre sinking) ──
  // Main asphalt lanes: from x = 1891.8 to x = 1905.2 (width 13.4m)
  const asphaltW = 13.4;
  const asphaltX = 1900 - (w / 2) + 2.2 + (asphaltW / 2); // 1891 + 2.2 + 6.7 = 1899.9
  const asphaltMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(asphaltW, len),
    M_ASPHALT,
  );
  asphaltMesh.rotateX(-Math.PI / 2);
  asphaltMesh.position.set(asphaltX, y + 0.005, midZ);
  asphaltMesh.receiveShadow = true;
  bridge.add(asphaltMesh);

  // ── Right Lane Granite Cobblestone Strip (from photo) ───────────────
  // Width 3.3m: from x = 1905.2 to x = 1908.5
  const cobbleW = 3.3;
  const cobbleX = 1905.2 + cobbleW / 2; // 1906.85
  const cobbleLane = new THREE.Mesh(
    new THREE.PlaneGeometry(cobbleW, len),
    M_COBBLE,
  );
  cobbleLane.rotateX(-Math.PI / 2);
  cobbleLane.position.set(cobbleX, y + 0.006, midZ);
  cobbleLane.receiveShadow = true;
  bridge.add(cobbleLane);

  // ── Road Markings (Exact from photo) ────────────────────────────────
  // Solid white divider line between asphalt and cobblestone lane
  const solidLine = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
  solidLine.scale.set(0.18, 0.01, len);
  solidLine.position.set(1905.2, y + 0.012, midZ);
  bridge.add(solidLine);

  // Solid white left shoulder line
  const leftShoulderLine = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
  leftShoulderLine.scale.set(0.18, 0.01, len);
  leftShoulderLine.position.set(1892.0, y + 0.012, midZ);
  bridge.add(leftShoulderLine);

  // Dashed white lane lines at x = 1896.4 and x = 1900.8
  for (const lx of [1896.4, 1900.8]) {
    for (let lz = end.z + 5; lz < start.z - 5; lz += 5.5) {
      const dash = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
      dash.scale.set(0.18, 0.01, 2.5);
      dash.position.set(lx, y + 0.012, lz);
      bridge.add(dash);
    }
  }

  // White directional arrows painted on asphalt pointing North (-z)
  for (const arrowZ of [580, 535]) {
    for (const arrowX of [1894.2, 1898.6]) {
      // Arrow stem
      const stem = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
      stem.scale.set(0.35, 0.01, 3.2);
      stem.position.set(arrowX, y + 0.014, arrowZ);
      bridge.add(stem);

      // Arrow head wings
      const headL = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
      headL.scale.set(0.28, 0.01, 1.4);
      headL.position.set(arrowX - 0.45, y + 0.014, arrowZ - 1.2);
      headL.rotation.y = 0.55;
      bridge.add(headL);

      const headR = new THREE.Mesh(G_BOX, M_WHITE_MARKING);
      headR.scale.set(0.28, 0.01, 1.4);
      headR.position.set(arrowX + 0.45, y + 0.014, arrowZ - 1.2);
      headR.rotation.y = -0.55;
      bridge.add(headR);
    }
  }

  // ── Left Sidewalk, Granite Curb & Stone Parapet Wall (West Side) ────
  // Granite curb (height 16cm)
  const curbLeft = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
  curbLeft.scale.set(0.35, 0.22, len);
  curbLeft.position.set(1891.65, y + 0.11, midZ);
  curbLeft.castShadow = true;
  bridge.add(curbLeft);

  // Cobblestone sidewalk (width 2.0m, from x = 1889.6 to 1891.6)
  const swLeft = new THREE.Mesh(G_BOX, M_COBBLE);
  swLeft.scale.set(2.0, 0.16, len);
  swLeft.position.set(1890.6, y + 0.08, midZ);
  swLeft.receiveShadow = true;
  bridge.add(swLeft);

  // Solid cut-stone parapet wall (height 1.15m, thickness 0.45m) matching photo
  const wallLeft = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  wallLeft.scale.set(0.45, 1.15, len);
  wallLeft.position.set(1889.4, y + 0.65, midZ);
  wallLeft.castShadow = true;
  wallLeft.receiveShadow = true;
  bridge.add(wallLeft);

  // Parapet stone coping top
  const copingLeft = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  copingLeft.scale.set(0.65, 0.16, len);
  copingLeft.position.set(1889.4, y + 1.28, midZ);
  copingLeft.castShadow = true;
  bridge.add(copingLeft);

  // ── Right Sidewalk, Granite Curb & Cast-Iron Railing (East Side) ────
  // Granite curb (height 16cm)
  const curbRight = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
  curbRight.scale.set(0.35, 0.22, len);
  curbRight.position.set(1908.65, y + 0.11, midZ);
  curbRight.castShadow = true;
  bridge.add(curbRight);

  // Cobblestone sidewalk (width 2.0m, from x = 1908.8 to 1910.8)
  const swRight = new THREE.Mesh(G_BOX, M_COBBLE);
  swRight.scale.set(2.0, 0.16, len);
  swRight.position.set(1909.8, y + 0.08, midZ);
  swRight.receiveShadow = true;
  bridge.add(swRight);

  // Cast-iron balustrade railing (height 1.15m) matching photo
  const railRight = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
  railRight.scale.set(0.25, 1.15, len);
  railRight.position.set(1910.9, y + 0.65, midZ);
  railRight.castShadow = true;
  bridge.add(railRight);

  // Handrail molded top
  const handrailRight = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
  handrailRight.scale.set(0.38, 0.14, len);
  handrailRight.position.set(1910.9, y + 1.28, midZ);
  bridge.add(handrailRight);

  // Stone pilaster posts along right railing every 12 meters
  for (let pz = end.z; pz <= start.z; pz += 12) {
    const post = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    post.scale.set(0.65, 1.35, 0.65);
    post.position.set(1910.9, y + 0.68, pz);
    post.castShadow = true;
    bridge.add(post);
  }

  // ── Vintage Arched Tbilisi Streetlamps (Matching Photo) ─────────────
  // Distinctive curved gooseneck arched lamps mounted along the balustrades
  for (let lz = end.z + 8; lz < start.z; lz += 16) {
    // Left side lamps (mounted on stone parapet, arching inward toward road)
    const poleL = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    poleL.scale.set(0.18, 5.2, 0.18);
    poleL.position.set(1889.4, y + 3.8, lz);
    poleL.castShadow = true;
    bridge.add(poleL);

    const archL = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    archL.scale.set(1.4, 0.14, 0.14);
    archL.position.set(1890.0, y + 6.3, lz);
    archL.rotation.z = -0.35;
    bridge.add(archL);

    const lanternL = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
    lanternL.scale.set(0.42, 0.55, 0.42);
    lanternL.position.set(1890.6, y + 6.0, lz);
    bridge.add(lanternL);

    // Right side lamps (mounted on cast-iron railing, arching inward toward road)
    const poleR = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    poleR.scale.set(0.18, 5.2, 0.18);
    poleR.position.set(1910.9, y + 3.8, lz);
    poleR.castShadow = true;
    bridge.add(poleR);

    const archR = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    archR.scale.set(1.4, 0.14, 0.14);
    archR.position.set(1910.3, y + 6.3, lz);
    archR.rotation.z = 0.35;
    bridge.add(archR);

    const lanternR = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
    lanternR.scale.set(0.42, 0.55, 0.42);
    lanternR.position.set(1909.7, y + 6.0, lz);
    bridge.add(lanternR);
  }

  // ── Massive Stone Under-Arches and River Piers ──────────────────────
  // Center arch piers anchored into the Kura riverbed below
  for (const pierZ of [530, 570]) {
    const pier = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    pier.scale.set(w * 0.95, 12, 8.5);
    pier.position.set(1900, y - 6.5, pierZ);
    pier.castShadow = true;
    pier.receiveShadow = true;
    bridge.add(pier);

    // Pointed cutwaters against river current
    for (const cutX of [1900 - w * 0.52, 1900 + w * 0.52]) {
      const cutwater = new THREE.Mesh(G_BOX, M_TUFF_WALL);
      cutwater.scale.set(3.8, 9, 8.5);
      cutwater.position.set(cutX, y - 7.5, pierZ);
      cutwater.rotation.y = cutX < 1900 ? 0.78 : -0.78;
      cutwater.castShadow = true;
      bridge.add(cutwater);
    }
  }

  return bridge;
}

/**
 * Helper to build an authentic ambient vehicle parked on the bridge (matching photo).
 */
function createBridgeCar(x: number, y: number, z: number, yaw: number, color: THREE.Material, isSUV = false): THREE.Group {
  const car = new THREE.Group();
  car.position.set(x, y, z);
  car.rotation.y = yaw;

  const w = isSUV ? 2.1 : 1.9;
  const l = isSUV ? 4.8 : 4.6;
  const h = isSUV ? 1.7 : 1.45;

  // Main chassis/body
  const body = new THREE.Mesh(G_BOX, color);
  body.scale.set(w, h * 0.55, l);
  body.position.y = 0.35 + (h * 0.55) / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  car.add(body);

  // Cabin / roof greenhouse
  const cabin = new THREE.Mesh(G_BOX, M_GLASS_TINTED);
  cabin.scale.set(w * 0.88, h * 0.45, l * 0.55);
  cabin.position.set(0, 0.35 + h * 0.55 + (h * 0.45) / 2, isSUV ? -0.1 : -0.2);
  cabin.castShadow = true;
  car.add(cabin);

  // 4 Wheels
  const halfTrack = w * 0.48;
  const wheelRadius = isSUV ? 0.38 : 0.34;
  for (const [wx, wz] of [[-halfTrack, l * 0.32], [halfTrack, l * 0.32], [-halfTrack, -l * 0.32], [halfTrack, -l * 0.32]]) {
    const tyre = new THREE.Mesh(G_CYL, M_CAR_TYRE);
    tyre.scale.set(wheelRadius * 2, 0.26, wheelRadius * 2);
    tyre.rotation.z = Math.PI / 2;
    tyre.position.set(wx, wheelRadius, wz);
    tyre.castShadow = true;
    car.add(tyre);

    const rim = new THREE.Mesh(G_CYL, M_CAR_WHEEL_RIM);
    rim.scale.set(wheelRadius * 1.3, 0.27, wheelRadius * 1.3);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(wx, wheelRadius, wz);
    car.add(rim);
  }

  return car;
}

/**
 * Adds ambient cars on the bridge shoulders exactly as shown in the Google Street View photo.
 */
function createBridgeAmbientVehicles(): THREE.Group {
  const group = new THREE.Group();
  const y = TBILISI_METEKHI_BRIDGE.deckElevation;

  // 1. Dark Grey SUV (Tiguan) parked on left shoulder (matching photo)
  group.add(createBridgeCar(1893.4, y, 565, Math.PI, M_CAR_GREY, true));

  // 2. Silver Sedan in middle-right lane
  group.add(createBridgeCar(1904.5, y, 538, Math.PI, M_CAR_SILVER, false));

  // 3. Blue Hatchback parked on right cobblestone shoulder
  group.add(createBridgeCar(1906.8, y, 575, Math.PI, M_CAR_BLUE, false));

  // 4. Black Crossover on right approach
  group.add(createBridgeCar(1904.0, y, 510, Math.PI, M_CAR_GREY, true));

  return group;
}

/**
 * 3. Gorgasali Square (Мейдан) & Old Tbilisi Street Architecture.
 * Multi-story merchant houses with authentic 3D depth, stone arcades, cafe awnings,
 * cantilevered wooden balconies ("шушабанди"), terracotta roofs, and church dome.
 */
function createOldTbilisiStreet(): THREE.Group {
  const street = new THREE.Group();
  const baseY = TBILISI_MEIDAN.elevation; // 14.50m

  // ── Gorgasali Square Cobblestone Paving ──────────────────────────────
  const plaza = new THREE.Mesh(
    new THREE.PlaneGeometry(TBILISI_MEIDAN.width, TBILISI_MEIDAN.length),
    M_COBBLE,
  );
  plaza.rotateX(-Math.PI / 2);
  plaza.position.set(TBILISI_MEIDAN.center.x, baseY + 0.005, TBILISI_MEIDAN.center.z);
  plaza.receiveShadow = true;
  street.add(plaza);

  // ── Left Side Buildings (Merchant Mansions & Cafes) ──────────────────
  const westBlocks = [
    { x: 1878, z: 475, w: 14, d: 20, h: 11.5, stories: 3 },
    { x: 1875, z: 450, w: 16, d: 22, h: 12.5, stories: 3 },
    { x: 1872, z: 425, w: 18, d: 22, h: 13.0, stories: 3 },
  ];

  for (const b of westBlocks) {
    const block = new THREE.Group();
    block.position.set(b.x, baseY, b.z);

    // Ground floor stone arcade / cafe
    const groundH = 4.2;
    const groundFloor = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    groundFloor.scale.set(b.w, groundH, b.d);
    groundFloor.position.y = groundH / 2;
    groundFloor.castShadow = true;
    groundFloor.receiveShadow = true;
    block.add(groundFloor);

    // Striped cafe awning over the sidewalk
    const awning = new THREE.Mesh(G_BOX, M_FLOWER_RED);
    awning.scale.set(2.2, 0.15, b.d * 0.85);
    awning.position.set(b.w / 2 + 1.1, groundH - 0.4, 0);
    awning.rotation.z = 0.25;
    awning.castShadow = true;
    block.add(awning);

    // Upper 2 stories with authentic photographic facade
    const upperH = b.h - groundH;
    const upper = new THREE.Mesh(G_BOX, M_HOUSE_FACADE);
    upper.scale.set(b.w * 0.98, upperH, b.d * 0.98);
    upper.position.set(0, groundH + upperH / 2, 0);
    upper.castShadow = true;
    upper.receiveShadow = true;
    block.add(upper);

    // Cantilevered wooden lace balcony ("шушабанди") jutting out toward the street
    const balW = 2.2;
    const balH = upperH * 0.75;
    const balL = b.d * 0.88;

    // Balcony floor slab
    const balFloor = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    balFloor.scale.set(balW, 0.25, balL);
    balFloor.position.set(b.w / 2 + balW / 2, groundH + 0.12, 0);
    balFloor.castShadow = true;
    block.add(balFloor);

    // Street-facing carved turquoise lace panel
    const balFace = new THREE.Mesh(
      new THREE.PlaneGeometry(balL, balH),
      M_BALCONY_FACADE,
    );
    balFace.position.set(b.w / 2 + balW, groundH + balH / 2 + 0.2, 0);
    balFace.rotation.y = Math.PI / 2;
    balFace.castShadow = true;
    block.add(balFace);

    // Support timber corbels underneath
    for (const corbelZ of [-balL * 0.35, 0, balL * 0.35]) {
      const corbel = new THREE.Mesh(G_BOX, M_TREE_TRUNK);
      corbel.scale.set(balW, 0.3, 0.35);
      corbel.position.set(b.w / 2 + balW / 2, groundH - 0.35, corbelZ);
      corbel.rotation.z = -0.35;
      block.add(corbel);
    }

    // Pitched terracotta tile roof with overhanging eaves
    const roofOverhang = 0.8;
    const roofW = b.w + roofOverhang * 2;
    const roofD = b.d + roofOverhang * 2;
    for (const [sign, rot] of [[-1, 0.48], [1, -0.48]]) {
      const roofSlope = new THREE.Mesh(G_BOX, M_ROOF_TILES);
      roofSlope.scale.set(roofW * 0.54, 0.28, roofD);
      roofSlope.position.set(sign * (roofW * 0.25), b.h + 1.2, 0);
      roofSlope.rotation.z = rot;
      roofSlope.castShadow = true;
      block.add(roofSlope);
    }

    street.add(block);
  }

  // ── Right Side Buildings (Old Town Riverfront Quarter & Church) ──────
  const eastBlocks = [
    { x: 1922, z: 475, w: 14, d: 20, h: 11.5 },
    { x: 1925, z: 450, w: 16, d: 22, h: 12.0 },
  ];

  for (const b of eastBlocks) {
    const block = new THREE.Group();
    block.position.set(b.x, baseY, b.z);

    const groundFloor = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    groundFloor.scale.set(b.w, 4.0, b.d);
    groundFloor.position.y = 2.0;
    groundFloor.castShadow = true;
    block.add(groundFloor);

    const upperH = b.h - 4.0;
    const upper = new THREE.Mesh(G_BOX, M_HOUSE_FACADE);
    upper.scale.set(b.w * 0.98, upperH, b.d * 0.98);
    upper.position.set(0, 4.0 + upperH / 2, 0);
    upper.castShadow = true;
    block.add(upper);

    // Balcony facing the street
    const balW = 2.0;
    const balH = upperH * 0.72;
    const balL = b.d * 0.85;
    const balFace = new THREE.Mesh(
      new THREE.PlaneGeometry(balL, balH),
      M_BALCONY_FACADE,
    );
    balFace.position.set(-b.w / 2 - balW, 4.0 + balH / 2 + 0.2, 0);
    balFace.rotation.y = -Math.PI / 2;
    balFace.castShadow = true;
    block.add(balFace);

    // Roof
    for (const [sign, rot] of [[-1, 0.48], [1, -0.48]]) {
      const roofSlope = new THREE.Mesh(G_BOX, M_ROOF_TILES);
      roofSlope.scale.set(b.w * 0.54, 0.28, b.d + 1.6);
      roofSlope.position.set(sign * (b.w * 0.25), b.h + 1.2, 0);
      roofSlope.rotation.z = rot;
      roofSlope.castShadow = true;
      block.add(roofSlope);
    }

    street.add(block);
  }

  // ── Traditional Georgian Church Dome (St. George / Sioni in Meidan) ──
  // Nestled among the rooftops on the right, exactly as visible in the photo
  const churchGroup = new THREE.Group();
  churchGroup.position.set(1930, baseY, 425);

  const churchBase = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  churchBase.scale.set(16, 12, 18);
  churchBase.position.y = 6.0;
  churchBase.castShadow = true;
  churchGroup.add(churchBase);

  // Cylindrical drum with lancet windows
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 6.2, 16),
    M_CHURCH_DRUM,
  );
  drum.position.y = 15.1;
  drum.castShadow = true;
  churchGroup.add(drum);

  // Conical stone umbrella roof
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 6.5, 24),
    M_CHURCH_ROOF,
  );
  cone.position.y = 21.4;
  cone.castShadow = true;
  churchGroup.add(cone);

  // Golden cross
  const crossV = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossV.scale.set(0.18, 2.2, 0.18);
  crossV.position.y = 25.4;
  churchGroup.add(crossV);

  street.add(churchGroup);

  return street;
}

/**
 * 4. Narikala Mountain Ridge & Fortress (Крепость Нарикала)
 * Towering green Caucasian mountain rising behind Old Tbilisi with:
 * - Ancient stone fortress curtain walls and cylindrical watchtowers ascending the ridge.
 * - Monumental 20-meter silver Kartlis Deda (Mother of Georgia) statue on the crest.
 * - Dense green Caucasian pine and cypress trees carpeting the slope.
 */
function createNarikalaRidge(): THREE.Group {
  const ridge = new THREE.Group();

  // ── Narikala Fortress Ancient Stone Walls & Towers ──────────────────
  // Fortification segments winding up the mountain from z = 430 to z = 330
  const wallWaypoints = [
    { x: 1845, z: 420, y: 32.0, w: 2.2, h: 7.5, len: 26, yaw: -0.35 },
    { x: 1835, z: 395, y: 48.0, w: 2.2, h: 8.5, len: 28, yaw: -0.42 },
    { x: 1830, z: 365, y: 64.0, w: 2.4, h: 9.0, len: 32, yaw: -0.25 },
    { x: 1838, z: 335, y: 80.0, w: 2.5, h: 9.5, len: 34, yaw: 0.15 },
    { x: 1865, z: 325, y: 86.0, w: 2.8, h: 9.0, len: 30, yaw: 0.85 },
  ];

  for (const wp of wallWaypoints) {
    const wallSeg = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    wallSeg.scale.set(wp.w, wp.h, wp.len);
    wallSeg.position.set(wp.x, wp.y + wp.h / 2, wp.z);
    wallSeg.rotation.y = wp.yaw;
    wallSeg.castShadow = true;
    wallSeg.receiveShadow = true;
    ridge.add(wallSeg);

    // Crenellated battlements along wall top
    const merlonCount = Math.floor(wp.len / 2.2);
    for (let m = 0; m < merlonCount; m += 2) {
      const merlon = new THREE.Mesh(G_BOX, M_TUFF_WALL);
      merlon.scale.set(wp.w * 1.1, 0.9, 1.2);
      const frac = (m / merlonCount) - 0.5;
      merlon.position.set(
        wp.x + Math.sin(wp.yaw) * (frac * wp.len),
        wp.y + wp.h + 0.45,
        wp.z + Math.cos(wp.yaw) * (frac * wp.len),
      );
      merlon.rotation.y = wp.yaw;
      merlon.castShadow = true;
      ridge.add(merlon);
    }
  }

  // Cylindrical Stone Bastion Towers
  const towers = [
    { x: 1850, z: 410, y: 35.0, r: 4.2, h: 14.0 },
    { x: 1832, z: 380, y: 55.0, r: 4.8, h: 15.0 },
    { x: 1828, z: 350, y: 72.0, r: 5.2, h: 16.0 },
    { x: 1852, z: 328, y: 85.0, r: 5.5, h: 16.5 },
  ];

  for (const tow of towers) {
    const towerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(tow.r * 0.85, tow.r, tow.h, 16),
      M_TUFF_WALL,
    );
    towerMesh.position.set(tow.x, tow.y + tow.h / 2, tow.z);
    towerMesh.castShadow = true;
    towerMesh.receiveShadow = true;
    ridge.add(towerMesh);

    // Conical timber roof
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(tow.r * 1.05, 4.5, 16),
      M_ROOF_TILES,
    );
    roof.position.set(tow.x, tow.y + tow.h + 2.25, tow.z);
    roof.castShadow = true;
    ridge.add(roof);
  }

  // ── Kartlis Deda (Мать Картли - Mother of Georgia) ──────────────────
  // 20-meter monumental silver/aluminum statue standing on the mountain peak
  const statue = new THREE.Group();
  statue.position.set(TBILISI_NARIKALA.statuePos.x, TBILISI_NARIKALA.statuePos.y, TBILISI_NARIKALA.statuePos.z);

  // Basalt foundation plinth
  const plinth = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  plinth.scale.set(6.5, 3.5, 6.5);
  plinth.position.y = 1.75;
  statue.add(plinth);

  // Flowing silver Georgian robe (lower volume)
  const robe = new THREE.Mesh(
    new THREE.CylinderGeometry(2.4, 3.6, 11.0, 16),
    M_SILVER_STATUE,
  );
  robe.position.y = 3.5 + 5.5;
  robe.castShadow = true;
  statue.add(robe);

  // Torso
  const torso = new THREE.Mesh(G_BOX, M_SILVER_STATUE);
  torso.scale.set(4.2, 5.0, 2.5);
  torso.position.y = 14.5;
  torso.castShadow = true;
  statue.add(torso);

  // Head and traditional Georgian headdress
  const head = new THREE.Mesh(G_BOX, M_SILVER_STATUE);
  head.scale.set(2.2, 2.6, 2.2);
  head.position.y = 18.0;
  head.castShadow = true;
  statue.add(head);

  // Left arm holding bowl of wine (for friends)
  const armL = new THREE.Mesh(G_BOX, M_SILVER_STATUE);
  armL.scale.set(3.5, 0.7, 0.7);
  armL.position.set(-2.8, 14.2, 0.8);
  armL.rotation.z = -0.35;
  statue.add(armL);

  const wineBowl = new THREE.Mesh(G_CYL, M_SILVER_STATUE);
  wineBowl.scale.set(1.4, 0.6, 1.4);
  wineBowl.position.set(-4.2, 14.8, 0.8);
  statue.add(wineBowl);

  // Right arm holding sword (for enemies)
  const armR = new THREE.Mesh(G_BOX, M_SILVER_STATUE);
  armR.scale.set(3.5, 0.7, 0.7);
  armR.position.set(2.8, 13.5, 0.6);
  armR.rotation.z = 0.45;
  statue.add(armR);

  const sword = new THREE.Mesh(G_BOX, M_SILVER_STATUE);
  sword.scale.set(0.35, 7.5, 0.15);
  sword.position.set(4.2, 15.0, 0.6);
  statue.add(sword);

  ridge.add(statue);

  // ── Dense Caucasian Mountain Pine & Cypress Forest ─────────────────
  const mountainTrees = [
    { x: 1860, z: 410, y: 36.0, h: 13, type: 'cypress' },
    { x: 1875, z: 390, y: 46.0, h: 14, type: 'plane' },
    { x: 1840, z: 375, y: 58.0, h: 12, type: 'cypress' },
    { x: 1885, z: 365, y: 65.0, h: 15, type: 'plane' },
    { x: 1855, z: 350, y: 74.0, h: 13, type: 'cypress' },
    { x: 1890, z: 340, y: 80.0, h: 14, type: 'plane' },
    { x: 1835, z: 330, y: 82.0, h: 12, type: 'cypress' },
    { x: 1880, z: 320, y: 86.0, h: 11, type: 'cypress' },
    { x: 1815, z: 360, y: 62.0, h: 13, type: 'plane' },
    { x: 1910, z: 370, y: 60.0, h: 14, type: 'cypress' },
  ];

  for (const t of mountainTrees) {
    if (t.type === 'cypress') ridge.add(createCypressTree(t.x, t.y, t.z, t.h));
    else ridge.add(createPlaneTree(t.x, t.y, t.z, t.h));
  }

  return ridge;
}

/**
 * 5. Rike-Narikala Aerial Cable Car (Канатная дорога)
 * High-tension steel cables stretching across the sky from Rike Park over the river
 * up to Narikala mountain summit, with modern glass observation cabins suspended in mid-air.
 */
function createAerialCableCar(): THREE.Group {
  const cableGroup = new THREE.Group();

  const startPt = new THREE.Vector3(1945, 22.0, 580); // Rike Park lower station side
  const endPt = new THREE.Vector3(1845, 88.0, 330);   // Narikala summit station

  const dir = new THREE.Vector3().subVectors(endPt, startPt);
  const totalLen = dir.length();
  const midPoint = new THREE.Vector3().addVectors(startPt, endPt).multiplyScalar(0.5);

  // Two parallel steel cables
  for (const sideOffset of [-0.65, 0.65]) {
    const cable = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    cable.scale.set(0.06, totalLen, 0.06);
    cable.position.copy(midPoint);
    cable.position.x += sideOffset;

    // Orient cylinder along the cable vector
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    cableGroup.add(cable);
  }

  // 3 Observation Cable Car Cabins (Gondolas) suspended along the cable in the sky
  const cabinFractions = [0.28, 0.58, 0.85];
  const cabinColors = [M_CAR_BLUE, M_FLOWER_RED, M_FLOWER_YELLOW];

  for (let i = 0; i < cabinFractions.length; i++) {
    const t = cabinFractions[i];
    const pos = new THREE.Vector3().lerpVectors(startPt, endPt, t);
    pos.x += i % 2 === 0 ? -0.65 : 0.65;

    const cabinGroup = new THREE.Group();
    cabinGroup.position.copy(pos);

    // Hanger arm connecting cabin to cable
    const hanger = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    hanger.scale.set(0.12, 2.2, 0.12);
    hanger.position.y = -1.1;
    cabinGroup.add(hanger);

    // Aerodynamic glass observation cabin
    const cabinBody = new THREE.Mesh(G_BOX, cabinColors[i]);
    cabinBody.scale.set(2.4, 2.2, 2.8);
    cabinBody.position.y = -3.2;
    cabinBody.castShadow = true;
    cabinGroup.add(cabinBody);

    // Panoramic panoramic glass windows
    const glass = new THREE.Mesh(G_BOX, M_GLASS_TINTED);
    glass.scale.set(2.45, 1.4, 2.6);
    glass.position.y = -3.1;
    cabinGroup.add(glass);

    cableGroup.add(cabinGroup);
  }

  return cableGroup;
}

/**
 * 6. Metekhi Cliff & Church (East Riverbank View)
 * Perched atop the dramatic cliff on the east side of the river gorge.
 */
function createMetekhiCliffAndChurch(): THREE.Group {
  const group = new THREE.Group();
  const center = TBILISI_METEKHI_CLIFF.center;
  const topY = TBILISI_METEKHI_CLIFF.topElevation;

  // Layered rock cliff faces
  const cliffSteps = [
    { dx: -18, dz: 6, w: 24, h: 22, d: 22, yaw: 0.2 },
    { dx: -10, dz: -12, w: 26, h: 24, d: 24, yaw: -0.15 },
    { dx: -20, dz: -4, w: 18, h: 20, d: 24, yaw: 0.05 },
    { dx: -4, dz: 18, w: 22, h: 18, d: 20, yaw: 0.35 },
  ];

  for (const step of cliffSteps) {
    const rock = new THREE.Mesh(G_BOX, M_CLIFF_ROCK);
    rock.scale.set(step.w, step.h, step.d);
    rock.position.set(center.x + step.dx, 3.5 + step.h / 2, center.z + step.dz);
    rock.rotation.y = step.yaw;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // Fortress parapet wall along cliff edge
  const wallCount = 20;
  for (let i = 0; i < wallCount; i++) {
    const angle = (i / wallCount) * Math.PI * 1.2 + Math.PI * 0.8;
    const wx = center.x + Math.cos(angle) * (TBILISI_METEKHI_CLIFF.radius - 6);
    const wz = center.z + Math.sin(angle) * (TBILISI_METEKHI_CLIFF.radius - 6);
    const seg = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    seg.scale.set(0.65, 1.4, 4.2);
    seg.position.set(wx, topY + 0.7, wz);
    seg.rotation.y = -angle + Math.PI / 2;
    seg.castShadow = true;
    group.add(seg);
  }

  // ── Metekhi Church of the Dormition ─────────────────────────────────
  const church = new THREE.Group();
  church.position.set(TBILISI_METEKHI_CHURCH.pos.x, TBILISI_METEKHI_CHURCH.pos.y, TBILISI_METEKHI_CHURCH.pos.z);
  church.rotation.y = TBILISI_METEKHI_CHURCH.yaw;

  // Stepped socle
  const socle = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  socle.scale.set(22, 1.2, 26);
  socle.position.y = 0.6;
  socle.castShadow = true;
  church.add(socle);

  // Nave & transepts
  const nave = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  nave.scale.set(13, 10.5, 23);
  nave.position.y = 5.85;
  nave.castShadow = true;
  church.add(nave);

  const transept = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  transept.scale.set(19, 10.0, 11);
  transept.position.y = 5.6;
  transept.castShadow = true;
  church.add(transept);

  // Eastern Apse
  const apse = new THREE.Mesh(G_CYL, M_CHURCH_FACADE);
  apse.scale.set(9.2, 9.8, 6.5);
  apse.position.set(0, 5.5, -11.5);
  apse.castShadow = true;
  church.add(apse);

  // 12-sided drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 6.8, 12),
    M_CHURCH_DRUM,
  );
  drum.position.y = 17.6;
  drum.castShadow = true;
  church.add(drum);

  // Conical stone tent roof
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 7.2, 24),
    M_CHURCH_ROOF,
  );
  cone.position.y = 25.2;
  cone.castShadow = true;
  church.add(cone);

  // Golden cross
  const crossV = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossV.scale.set(0.18, 2.6, 0.18);
  crossV.position.y = 29.6;
  church.add(crossV);

  const crossH = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossH.scale.set(1.5, 0.18, 0.18);
  crossH.position.y = 30.0;
  church.add(crossH);

  group.add(church);

  // ── King Vakhtang Gorgasali Equestrian Monument ────────────────────
  const monument = new THREE.Group();
  monument.position.set(TBILISI_GORGASALI_STATUE.pos.x, TBILISI_GORGASALI_STATUE.pos.y, TBILISI_GORGASALI_STATUE.pos.z);
  monument.rotation.y = TBILISI_GORGASALI_STATUE.yaw;

  const ped = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  ped.scale.set(4.2, 4.0, 5.6);
  ped.position.y = 2.0;
  ped.castShadow = true;
  monument.add(ped);

  const cardZ = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 6.5), M_GORGASALI_CUTOUT);
  cardZ.position.set(0, 7.25, 0);
  cardZ.rotation.y = Math.PI / 2;
  cardZ.castShadow = true;
  monument.add(cardZ);

  const cardX = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 6.5), M_GORGASALI_CUTOUT);
  cardX.position.set(0, 7.25, 0);
  cardX.castShadow = true;
  monument.add(cardX);

  const horse = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horse.scale.set(1.4, 2.2, 3.6);
  horse.position.set(0, 5.8, 0);
  horse.castShadow = true;
  monument.add(horse);

  group.add(monument);

  return group;
}

/**
 * 7. Europe Square (South Approach Roundabout & Plazas)
 */
function createEuropeSquare(): THREE.Group {
  const group = new THREE.Group();
  const rb = TBILISI_ROUNDABOUT;
  const y = rb.roadElevation;

  // Asphalt roundabout road ring
  const roadGeom = new THREE.RingGeometry(rb.innerRadius, rb.outerRadius, 64);
  roadGeom.rotateX(-Math.PI / 2);
  const roadMesh = new THREE.Mesh(roadGeom, M_ASPHALT);
  roadMesh.position.set(rb.center.x, y + 0.005, rb.center.z);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Central park island lawn
  const lawnGeom = new THREE.CircleGeometry(rb.innerRadius - 0.2, 48);
  lawnGeom.rotateX(-Math.PI / 2);
  const lawn = new THREE.Mesh(lawnGeom, M_LAWN_GRASS);
  lawn.position.set(rb.center.x, y + 0.02, rb.center.z);
  lawn.receiveShadow = true;
  group.add(lawn);

  // Circular flower beds
  const fRing = new THREE.RingGeometry(5.0, 8.5, 36);
  fRing.rotateX(-Math.PI / 2);
  const f1 = new THREE.Mesh(fRing, M_FLOWER_RED);
  f1.position.set(rb.center.x, y + 0.03, rb.center.z);
  group.add(f1);

  // Central commemorative column monument
  const colBase = new THREE.Mesh(G_CYL, M_DARK_BASALT);
  colBase.scale.set(3.8, 0.8, 3.8);
  colBase.position.set(rb.center.x, y + 0.4, rb.center.z);
  colBase.castShadow = true;
  group.add(colBase);

  const column = new THREE.Mesh(G_CYL, M_TUFF_WALL);
  column.scale.set(1.2, 8.5, 1.2);
  column.position.set(rb.center.x, y + 4.65, rb.center.z);
  column.castShadow = true;
  group.add(column);

  const star = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  star.scale.set(0.4, 1.6, 0.4);
  star.position.set(rb.center.x, y + 9.6, rb.center.z);
  group.add(star);

  return group;
}

/**
 * 8. Emerald Kura River Water (Река Кура / Мтквари)
 */
function createKuraRiverWater(): THREE.Group {
  const waterGroup = new THREE.Group();
  const points = TBILISI_KURA_LINE;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const yaw = Math.atan2(dx, dz);

    const segment = new THREE.Mesh(G_BOX, M_KURA_WATER);
    segment.scale.set(TBILISI_KURA_RIVER.halfWidth * 2.2, 0.3, len + 2);
    segment.position.set((a.x + b.x) / 2, TBILISI_KURA_RIVER.waterElevation, (a.z + b.z) / 2);
    segment.rotation.y = yaw;
    waterGroup.add(segment);
  }

  return waterGroup;
}

/**
 * Italian Cypress Tree Helper
 */
function createCypressTree(x: number, y: number, z: number, height = 11): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, y, z);

  const trunk = new THREE.Mesh(G_CYL, M_TREE_TRUNK);
  trunk.scale.set(0.35, height * 0.28, 0.35);
  trunk.position.y = height * 0.14;
  trunk.castShadow = true;
  tree.add(trunk);

  const tiers = [
    { y: height * 0.32, h: height * 0.45, r: 1.2 },
    { y: height * 0.52, h: height * 0.42, r: 1.0 },
    { y: height * 0.72, h: height * 0.38, r: 0.75 },
    { y: height * 0.88, h: height * 0.28, r: 0.45 },
  ];

  for (const tier of tiers) {
    const cone = new THREE.Mesh(G_CONE, M_CYPRESS_FOLIAGE);
    cone.scale.set(tier.r * 2, tier.h, tier.r * 2);
    cone.position.y = tier.y;
    cone.castShadow = true;
    tree.add(cone);
  }

  return tree;
}

/**
 * Deciduous Plane Tree Helper
 */
function createPlaneTree(x: number, y: number, z: number, height = 9): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, y, z);

  const trunk = new THREE.Mesh(G_CYL, M_TREE_TRUNK);
  trunk.scale.set(0.5, height * 0.45, 0.5);
  trunk.position.y = height * 0.225;
  trunk.castShadow = true;
  tree.add(trunk);

  const canopy = new THREE.Mesh(
    new THREE.DodecahedronGeometry(height * 0.48, 1),
    M_PLANE_TREE_FOLIAGE,
  );
  canopy.position.y = height * 0.65;
  canopy.scale.set(1.1, 0.85, 1.1);
  canopy.castShadow = true;
  tree.add(canopy);

  return tree;
}

/**
 * Builds and returns the complete photorealistic Tbilisi Europe Square & Metekhi Bridge scene.
 */
export function buildTbilisiDistrict(heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tbilisi-district';

  // 1. Satellite Orthophoto base
  group.add(createOrthophotoGround(heightAt));

  // 2. Metekhi Bridge (Foregrouund - 100% matching Google Street View photo)
  group.add(createMetekhiBridge());

  // 3. Ambient parked / driving cars on Metekhi Bridge (matching photo)
  group.add(createBridgeAmbientVehicles());

  // 4. Gorgasali Square (Meidan) & Old Tbilisi Architecture (Midground)
  group.add(createOldTbilisiStreet());

  // 5. Narikala Mountain Ridge, Ancient Fortress & Kartlis Deda (Background)
  group.add(createNarikalaRidge());

  // 6. Rike-Narikala Aerial Cable Car (Across the sky with suspended gondolas)
  group.add(createAerialCableCar());

  // 7. Metekhi Cliff & Church of the Dormition (East Riverbank View)
  group.add(createMetekhiCliffAndChurch());

  // 8. Europe Square Roundabout (South Approach)
  group.add(createEuropeSquare());

  // 9. Emerald Kura River Water
  group.add(createKuraRiverWater());

  return group;
}
