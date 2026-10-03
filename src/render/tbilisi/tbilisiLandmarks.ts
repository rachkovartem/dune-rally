// src/render/tbilisi/tbilisiLandmarks.ts
// Photorealistic 3D architectural landmarks and authentic textured urban environment
// for Tbilisi Europe Square, Metekhi Church, Gorgasali Monument, Metekhi Bridge, and Old Tbilisi.
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
  TBILISI_PEACE_BRIDGE, TBILISI_KURA_LINE, TBILISI_KURA_RIVER,
  TBILISI_ROUNDABOUT, TBILISI_METEKHI_CLIFF,
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
  map: loadRepeatTexture(cobbleUrl, 8, 8),
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

const M_YELLOW_LINE = new THREE.MeshStandardMaterial({
  color: 0xf5b027,
  roughness: 0.55,
  metalness: 0.05,
});

const M_WHITE_LINE = new THREE.MeshStandardMaterial({
  color: 0xeeeeee,
  roughness: 0.5,
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

const M_CANOPY_GLASS = new THREE.MeshStandardMaterial({
  color: 0x88d4e8,
  transparent: true,
  opacity: 0.65,
  roughness: 0.1,
  metalness: 0.6,
  side: THREE.DoubleSide,
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
    // Base height offset
    pos.setY(i, groundY + 0.03);
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
 * 2. Europe Square Roundabout & Pavements
 * Authentic circular road with dark aggregate asphalt, raised granite curbs,
 * cobblestone perimeter walkways, and landscaped central park island with flowerbeds.
 */
function createEuropeSquare(heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  const rb = TBILISI_ROUNDABOUT;
  const cx = rb.center.x;
  const cz = rb.center.z;
  const y = rb.roadElevation;

  // ── Asphalt Roundabout Road Ring ────────────────────────────────────
  const roadGeom = new THREE.RingGeometry(rb.innerRadius, rb.outerRadius, 64);
  roadGeom.rotateX(-Math.PI / 2);
  const roadMesh = new THREE.Mesh(roadGeom, M_ASPHALT);
  roadMesh.position.set(cx, y + 0.08, cz);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // ── Dashed White Lane Divider Ring ──────────────────────────────────
  const midRadius = (rb.innerRadius + rb.outerRadius) / 2;
  const dashCount = 24;
  for (let i = 0; i < dashCount; i++) {
    const angle = (i / dashCount) * Math.PI * 2;
    const dx = Math.cos(angle) * midRadius;
    const dz = Math.sin(angle) * midRadius;
    const dash = new THREE.Mesh(G_BOX, M_WHITE_LINE);
    dash.scale.set(0.25, 0.02, 2.2);
    dash.position.set(cx + dx, y + 0.10, cz + dz);
    dash.rotation.y = -angle + Math.PI / 2;
    group.add(dash);
  }

  // ── Granite Curbs ───────────────────────────────────────────────────
  // Outer curb ring
  const outerCurbs = 48;
  for (let i = 0; i < outerCurbs; i++) {
    const a1 = (i / outerCurbs) * Math.PI * 2;
    const a2 = ((i + 1) / outerCurbs) * Math.PI * 2;
    const midAngle = (a1 + a2) / 2;
    const segLen = rb.outerRadius * (2 * Math.PI / outerCurbs);
    const curb = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
    curb.scale.set(0.35, 0.22, segLen + 0.05);
    curb.position.set(
      cx + Math.cos(midAngle) * (rb.outerRadius + 0.15),
      y + 0.12,
      cz + Math.sin(midAngle) * (rb.outerRadius + 0.15),
    );
    curb.rotation.y = -midAngle + Math.PI / 2;
    curb.castShadow = true;
    curb.receiveShadow = true;
    group.add(curb);
  }

  // Inner curb ring
  const innerCurbs = 36;
  for (let i = 0; i < innerCurbs; i++) {
    const midAngle = ((i + 0.5) / innerCurbs) * Math.PI * 2;
    const segLen = rb.innerRadius * (2 * Math.PI / innerCurbs);
    const curb = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
    curb.scale.set(0.35, 0.25, segLen + 0.05);
    curb.position.set(
      cx + Math.cos(midAngle) * (rb.innerRadius - 0.15),
      y + 0.15,
      cz + Math.sin(midAngle) * (rb.innerRadius - 0.15),
    );
    curb.rotation.y = -midAngle + Math.PI / 2;
    curb.castShadow = true;
    group.add(curb);
  }

  // ── Central Park Island ─────────────────────────────────────────────
  const lawnGeom = new THREE.CircleGeometry(rb.innerRadius - 0.2, 48);
  lawnGeom.rotateX(-Math.PI / 2);
  const lawn = new THREE.Mesh(lawnGeom, M_LAWN_GRASS);
  lawn.position.set(cx, y + 0.22, cz);
  lawn.receiveShadow = true;
  group.add(lawn);

  // Concentric flowerbeds on central island
  const flowerRing1 = new THREE.RingGeometry(6.5, 9.5, 36);
  flowerRing1.rotateX(-Math.PI / 2);
  const f1 = new THREE.Mesh(flowerRing1, M_FLOWER_RED);
  f1.position.set(cx, y + 0.24, cz);
  group.add(f1);

  const flowerRing2 = new THREE.RingGeometry(3.0, 5.0, 28);
  flowerRing2.rotateX(-Math.PI / 2);
  const f2 = new THREE.Mesh(flowerRing2, M_FLOWER_YELLOW);
  f2.position.set(cx, y + 0.25, cz);
  group.add(f2);

  // Europe Square Central Column Monument
  const monBase = new THREE.Mesh(G_CYL, M_DARK_BASALT);
  monBase.scale.set(4.2, 0.8, 4.2);
  monBase.position.set(cx, y + 0.6, cz);
  monBase.castShadow = true;
  group.add(monBase);

  const monSocle = new THREE.Mesh(G_CYL, M_TUFF_WALL);
  monSocle.scale.set(2.4, 1.2, 2.4);
  monSocle.position.set(cx, y + 1.4, cz);
  monSocle.castShadow = true;
  group.add(monSocle);

  const monCol = new THREE.Mesh(G_CYL, M_TUFF_WALL);
  monCol.scale.set(1.1, 7.5, 1.1);
  monCol.position.set(cx, y + 5.5, cz);
  monCol.castShadow = true;
  group.add(monCol);

  const monCross = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  monCross.scale.set(0.3, 1.4, 0.3);
  monCross.position.set(cx, y + 9.8, cz);
  group.add(monCross);

  // ── Cobblestone Sidewalk Ring & Streetlamps ─────────────────────────
  const sideGeom = new THREE.RingGeometry(rb.outerRadius + 0.35, rb.outerRadius + 6.0, 48);
  sideGeom.rotateX(-Math.PI / 2);
  const sideMesh = new THREE.Mesh(sideGeom, M_COBBLE);
  sideMesh.position.set(cx, y + 0.12, cz);
  sideMesh.receiveShadow = true;
  group.add(sideMesh);

  // 8 Classic vintage cast-iron streetlamps around the circle
  const lampCount = 8;
  for (let i = 0; i < lampCount; i++) {
    const angle = (i / lampCount) * Math.PI * 2;
    const lx = cx + Math.cos(angle) * (rb.outerRadius + 2.5);
    const lz = cz + Math.sin(angle) * (rb.outerRadius + 2.5);
    const groundH = heightAt(lx, lz);

    const post = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    post.scale.set(0.2, 4.5, 0.2);
    post.position.set(lx, groundH + 2.25, lz);
    post.castShadow = true;
    group.add(post);

    // Twin horizontal bracket arms
    const arm = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    arm.scale.set(1.4, 0.12, 0.12);
    arm.position.set(lx, groundH + 4.3, lz);
    arm.rotation.y = -angle;
    group.add(arm);

    // Warm glowing lanterns on each arm
    for (const side of [-0.65, 0.65]) {
      const lantern = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
      lantern.scale.set(0.35, 0.45, 0.35);
      lantern.position.set(
        lx + Math.sin(angle) * side,
        groundH + 4.5,
        lz - Math.cos(angle) * side,
      );
      group.add(lantern);
    }
  }

  // Zebra pedestrian crossing leading onto Metekhi Bridge
  const bridgeStart = TBILISI_METEKHI_BRIDGE.start;
  const bridgeYaw = Math.atan2(TBILISI_METEKHI_BRIDGE.end.x - bridgeStart.x, TBILISI_METEKHI_BRIDGE.end.z - bridgeStart.z);
  for (let z = -6; z <= 6; z += 1.4) {
    const stripe = new THREE.Mesh(G_BOX, M_WHITE_LINE);
    stripe.scale.set(3.2, 0.02, 0.7);
    stripe.position.set(bridgeStart.x, y + 0.11, bridgeStart.z + z);
    stripe.rotation.y = bridgeYaw;
    group.add(stripe);
  }

  return group;
}

/**
 * 3. Metekhi Bridge (Мост Метехи)
 * Spans across the emerald Kura gorge connecting Europe Square to Old Town Meidan.
 * Authentic dark aggregate asphalt deck, cobblestone sidewalks, cast-iron balustrades,
 * twin stone under-arches, massive piers, and vintage street lamps.
 */
function createMetekhiBridge(): THREE.Group {
  const bridge = new THREE.Group();
  const start = TBILISI_METEKHI_BRIDGE.start;
  const end = TBILISI_METEKHI_BRIDGE.end;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const midX = (start.x + end.x) / 2;
  const midZ = (start.z + end.z) / 2;
  const deckY = TBILISI_METEKHI_BRIDGE.deckElevation;
  const w = TBILISI_METEKHI_BRIDGE.width;

  bridge.position.set(midX, deckY, midZ);
  bridge.rotation.y = yaw;

  // ── Asphalt Roadway Deck ────────────────────────────────────────────
  const roadwayW = w - 4.4;
  const deck = new THREE.Mesh(G_BOX, M_ASPHALT);
  deck.scale.set(roadwayW, 1.0, len);
  deck.position.y = -0.5;
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);

  // Double yellow centerline
  const doubleYellow1 = new THREE.Mesh(G_BOX, M_YELLOW_LINE);
  doubleYellow1.scale.set(0.14, 0.02, len);
  doubleYellow1.position.set(-0.12, 0.02, 0);
  bridge.add(doubleYellow1);

  const doubleYellow2 = new THREE.Mesh(G_BOX, M_YELLOW_LINE);
  doubleYellow2.scale.set(0.14, 0.02, len);
  doubleYellow2.position.set(0.12, 0.02, 0);
  bridge.add(doubleYellow2);

  // White lane shoulder lines
  for (const side of [-1, 1]) {
    const whiteLine = new THREE.Mesh(G_BOX, M_WHITE_LINE);
    whiteLine.scale.set(0.16, 0.02, len);
    whiteLine.position.set(side * (roadwayW / 2 - 0.4), 0.02, 0);
    bridge.add(whiteLine);
  }

  // ── Cobblestone Sidewalks & Curbs ───────────────────────────────────
  for (const side of [-1, 1]) {
    const swX = side * (w / 2 - 1.1);

    // Granite curb separating sidewalk from roadway
    const curb = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
    curb.scale.set(0.35, 0.28, len);
    curb.position.set(side * (roadwayW / 2 + 0.17), 0.14, 0);
    curb.castShadow = true;
    bridge.add(curb);

    // Cobblestone pedestrian sidewalk
    const sidewalk = new THREE.Mesh(G_BOX, M_COBBLE);
    sidewalk.scale.set(2.2, 0.25, len);
    sidewalk.position.set(swX, 0.12, 0);
    sidewalk.receiveShadow = true;
    bridge.add(sidewalk);

    // Cast-iron balustrade / railing with vertical balusters
    const parapet = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    parapet.scale.set(0.22, 1.1, len);
    parapet.position.set(side * (w / 2 - 0.12), 0.72, 0);
    parapet.castShadow = true;
    bridge.add(parapet);

    // Handrail molded top
    const handrail = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
    handrail.scale.set(0.36, 0.12, len);
    handrail.position.set(side * (w / 2 - 0.12), 1.32, 0);
    bridge.add(handrail);
  }

  // ── Massive Stone Under-Arches and River Piers ──────────────────────
  // Main supporting bridge understructure
  const underDeck = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  underDeck.scale.set(w * 0.94, 2.2, len * 0.98);
  underDeck.position.y = -1.6;
  underDeck.castShadow = true;
  underDeck.receiveShadow = true;
  bridge.add(underDeck);

  // Twin massive stone piers reaching down to riverbed (-12m)
  for (const t of [-0.26, 0.26]) {
    const pier = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    pier.scale.set(w * 0.92, 12, 7.5);
    pier.position.set(0, -6.5, t * len);
    pier.castShadow = true;
    pier.receiveShadow = true;
    bridge.add(pier);

    // Pier cutwaters (pointed stone wedges against river current)
    for (const cutSide of [-1, 1]) {
      const cutwater = new THREE.Mesh(G_BOX, M_TUFF_WALL);
      cutwater.scale.set(3.5, 9, 7.5);
      cutwater.position.set(cutSide * (w * 0.52), -7.5, t * len);
      cutwater.rotation.y = cutSide * 0.78;
      cutwater.castShadow = true;
      bridge.add(cutwater);
    }
  }

  // ── Historic Cast-Iron Streetlamps with Glowing Double Lanterns ─────
  for (const zOff of [-0.38, -0.13, 0.13, 0.38]) {
    for (const side of [-1, 1]) {
      const lx = side * (w / 2 - 0.15);
      const lz = zOff * len;

      const pole = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
      pole.scale.set(0.18, 4.2, 0.18);
      pole.position.set(lx, 2.3, lz);
      pole.castShadow = true;
      bridge.add(pole);

      const crossArm = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
      crossArm.scale.set(1.2, 0.12, 0.12);
      crossArm.position.set(lx, 4.3, lz);
      bridge.add(crossArm);

      for (const lanternOffset of [-0.55, 0.55]) {
        const lantern = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
        lantern.scale.set(0.38, 0.52, 0.38);
        lantern.position.set(lx, 4.5, lz + lanternOffset);
        bridge.add(lantern);
      }
    }
  }

  return bridge;
}

/**
 * 4. Metekhi Cliff (Скала Метехи) & Fortress Retaining Wall
 * Steep rugged stratified bedrock bluff rising 25m out of the Kura gorge,
 * crowned with the ancient Metekhi fortress stone parapet.
 */
function createMetekhiCliff(heightAt: (x: number, z: number) => number): THREE.Group {
  const cliffGroup = new THREE.Group();
  const center = TBILISI_METEKHI_CLIFF.center;
  const topY = TBILISI_METEKHI_CLIFF.topElevation;

  // Multi-tier layered rock faces protruding along the riverfront
  const rockSteps = [
    { dx: -22, dz: 10, w: 26, h: 22, d: 24, yaw: 0.25 },
    { dx: -14, dz: -12, w: 28, h: 24, d: 26, yaw: -0.15 },
    { dx: -26, dz: -4, w: 20, h: 20, d: 28, yaw: 0.05 },
    { dx: -6, dz: 24, w: 24, h: 18, d: 20, yaw: 0.45 },
    { dx: -18, dz: 30, w: 22, h: 16, d: 22, yaw: 0.30 },
  ];

  for (const step of rockSteps) {
    const rx = center.x + step.dx;
    const rz = center.z + step.dz;
    const rock = new THREE.Mesh(G_BOX, M_CLIFF_ROCK);
    rock.scale.set(step.w, step.h, step.d);
    rock.position.set(rx, 3.5 + step.h / 2, rz);
    rock.rotation.y = step.yaw;
    rock.castShadow = true;
    rock.receiveShadow = true;
    cliffGroup.add(rock);
  }

  // Upper cliff plateau cobblestone terrace
  const plateauGeom = new THREE.CircleGeometry(TBILISI_METEKHI_CLIFF.radius - 8, 36);
  plateauGeom.rotateX(-Math.PI / 2);
  const plateau = new THREE.Mesh(plateauGeom, M_COBBLE);
  plateau.position.set(center.x, topY + 0.05, center.z);
  plateau.receiveShadow = true;
  cliffGroup.add(plateau);

  // Ancient stone fortress parapet wall with crenellations along cliff rim
  const wallCount = 28;
  for (let i = 0; i < wallCount; i++) {
    const angle = (i / wallCount) * Math.PI * 1.35 + Math.PI * 0.75;
    const wx = center.x + Math.cos(angle) * (TBILISI_METEKHI_CLIFF.radius - 7);
    const wz = center.z + Math.sin(angle) * (TBILISI_METEKHI_CLIFF.radius - 7);
    const wy = Math.max(26.0, heightAt(wx, wz));

    const segLen = (TBILISI_METEKHI_CLIFF.radius - 7) * (Math.PI * 1.35 / wallCount);
    const wallSeg = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    wallSeg.scale.set(0.65, 1.4, segLen + 0.1);
    wallSeg.position.set(wx, wy + 0.7, wz);
    wallSeg.rotation.y = -angle + Math.PI / 2;
    wallSeg.castShadow = true;
    cliffGroup.add(wallSeg);

    // Battlements / merlons every other segment
    if (i % 2 === 0) {
      const merlon = new THREE.Mesh(G_BOX, M_TUFF_WALL);
      merlon.scale.set(0.7, 0.6, segLen * 0.5);
      merlon.position.set(wx, wy + 1.7, wz);
      merlon.rotation.y = -angle + Math.PI / 2;
      merlon.castShadow = true;
      cliffGroup.add(merlon);
    }
  }

  return cliffGroup;
}

/**
 * 5. Metekhi Church of the Dormition (Церковь Метехи)
 * Masterpiece of 13th-century Georgian ecclesiastical architecture.
 * Features authentic cruciform plan, yellow-ochre tuff stone masonry,
 * eastern apse with carved blind arches, western portal, pitched gable terracotta roofs,
 * 12-sided drum with lancet windows and blind arcade, conical umbrella roof, and golden cross.
 */
function createMetekhiChurch(): THREE.Group {
  const church = new THREE.Group();
  church.position.set(TBILISI_METEKHI_CHURCH.pos.x, TBILISI_METEKHI_CHURCH.pos.y, TBILISI_METEKHI_CHURCH.pos.z);
  church.rotation.y = TBILISI_METEKHI_CHURCH.yaw;

  // ── Stepped Foundation Socle ────────────────────────────────────────
  const socle = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  socle.scale.set(22, 1.2, 26);
  socle.position.y = 0.6;
  socle.castShadow = true;
  church.add(socle);

  // ── Western Nave (Central Long Hall) ─────────────────────────────────
  const nave = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  nave.scale.set(13, 10.5, 23);
  nave.position.y = 5.85;
  nave.castShadow = true;
  nave.receiveShadow = true;
  church.add(nave);

  // ── North & South Transepts (Cross Arms) ─────────────────────────────
  const transept = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  transept.scale.set(19, 10.0, 11);
  transept.position.y = 5.6;
  transept.castShadow = true;
  transept.receiveShadow = true;
  church.add(transept);

  // ── Eastern Semicircular Apse with Carved Georgian Relief Arches ────
  const apse = new THREE.Mesh(G_CYL, M_CHURCH_FACADE);
  apse.scale.set(9.2, 9.8, 6.5);
  apse.position.set(0, 5.5, -11.5);
  apse.castShadow = true;
  church.add(apse);

  // Apse half-conical roof
  const apseRoof = new THREE.Mesh(G_CONE, M_ROOF_TILES);
  apseRoof.scale.set(9.6, 3.8, 6.8);
  apseRoof.position.set(0, 12.3, -11.5);
  apseRoof.castShadow = true;
  church.add(apseRoof);

  // ── Western & Southern Arched Entrance Portals ──────────────────────
  // Western main entrance portal
  const westPortal = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  westPortal.scale.set(6.2, 5.5, 3.2);
  westPortal.position.set(0, 2.75, 12.8);
  westPortal.castShadow = true;
  church.add(westPortal);

  const westPortalArch = new THREE.Mesh(G_CYL, M_CHURCH_FACADE);
  westPortalArch.scale.set(4.0, 1.8, 4.0);
  westPortalArch.position.set(0, 5.5, 12.8);
  westPortalArch.rotation.x = Math.PI / 2;
  church.add(westPortalArch);

  // Southern portal porch
  const southPortal = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  southPortal.scale.set(3.0, 5.2, 5.0);
  southPortal.position.set(10.2, 2.6, 0);
  southPortal.castShadow = true;
  church.add(southPortal);

  // ── Gable Pitched Terracotta Roofs with Stone Eaves Cornices ────────
  // Nave North/South sloping roof wings
  for (const [sign, rot] of [[-1, 0.52], [1, -0.52]]) {
    const roofWing = new THREE.Mesh(G_BOX, M_ROOF_TILES);
    roofWing.scale.set(7.2, 0.35, 23.5);
    roofWing.position.set(sign * 3.4, 12.2, 0);
    roofWing.rotation.z = rot;
    roofWing.castShadow = true;
    church.add(roofWing);
  }

  // Transept East/West sloping roof wings
  for (const [sign, rot] of [[-1, -0.52], [1, 0.52]]) {
    const roofWing = new THREE.Mesh(G_BOX, M_ROOF_TILES);
    roofWing.scale.set(19.5, 0.35, 6.2);
    roofWing.position.set(0, 11.8, sign * 2.8);
    roofWing.rotation.x = rot;
    roofWing.castShadow = true;
    church.add(roofWing);
  }

  // ── Square Pediment Crossing Base ───────────────────────────────────
  const crossingBase = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  crossingBase.scale.set(8.2, 2.4, 8.2);
  crossingBase.position.y = 13.0;
  crossingBase.castShadow = true;
  church.add(crossingBase);

  // ── 12-Sided Cylindrical Drum with Lancet Windows & Blind Arches ────
  // Textured with authentic photography of Metekhi Church's drum
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(3.6, 3.6, 6.8, 12),
    M_CHURCH_DRUM,
  );
  drum.position.y = 17.6;
  drum.castShadow = true;
  drum.receiveShadow = true;
  church.add(drum);

  // Drum stone cornice frieze
  const drumEaves = new THREE.Mesh(
    new THREE.CylinderGeometry(4.1, 3.7, 0.6, 24),
    M_TUFF_WALL,
  );
  drumEaves.position.y = 21.3;
  drumEaves.castShadow = true;
  church.add(drumEaves);

  // ── Characteristic Georgian Conical Stone Umbrella Tent Roof ───────
  // Textured with authentic conical stone roof tiles
  const coneRoof = new THREE.Mesh(
    new THREE.ConeGeometry(4.2, 7.2, 24),
    M_CHURCH_ROOF,
  );
  coneRoof.position.y = 25.2;
  coneRoof.castShadow = true;
  church.add(coneRoof);

  // ── Detailed Golden Cross at Apex ───────────────────────────────────
  const crossGroup = new THREE.Group();
  crossGroup.position.y = 29.6;

  // Vertical staff
  const crossV = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossV.scale.set(0.18, 2.6, 0.18);
  crossGroup.add(crossV);

  // Horizontal main bar
  const crossH = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossH.scale.set(1.5, 0.18, 0.18);
  crossH.position.y = 0.45;
  crossGroup.add(crossH);

  // Upper bar (Orthodox cross)
  const crossU = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossU.scale.set(0.65, 0.14, 0.14);
  crossU.position.y = 0.95;
  crossGroup.add(crossU);

  // Lower slanted footrest
  const crossF = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossF.scale.set(0.7, 0.14, 0.14);
  crossF.position.y = -0.55;
  crossF.rotation.z = 0.35;
  crossGroup.add(crossF);

  church.add(crossGroup);

  return church;
}

/**
 * 6. King Vakhtang Gorgasali Monument (Памятник Вахтангу Горгасали)
 * The legendary equestrian monument on the cliff edge overlook.
 * Comprises a massive stepped dark basalt plinth, 3D bronze horse and king volume,
 * and high-resolution photographic cutout star-planes for authentic photographic likeness.
 */
function createGorgasaliMonument(): THREE.Group {
  const monument = new THREE.Group();
  monument.position.set(TBILISI_GORGASALI_STATUE.pos.x, TBILISI_GORGASALI_STATUE.pos.y, TBILISI_GORGASALI_STATUE.pos.z);
  monument.rotation.y = TBILISI_GORGASALI_STATUE.yaw;

  // ── Stepped Dark Basalt Pedestal ────────────────────────────────────
  const step1 = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  step1.scale.set(6.4, 0.7, 7.8);
  step1.position.y = 0.35;
  step1.castShadow = true;
  monument.add(step1);

  const step2 = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  step2.scale.set(5.0, 0.6, 6.4);
  step2.position.y = 0.95;
  step2.castShadow = true;
  monument.add(step2);

  // Main vertical plinth with molded edges
  const mainPlinth = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  mainPlinth.scale.set(3.8, 3.6, 5.4);
  mainPlinth.position.y = 3.05;
  mainPlinth.castShadow = true;
  mainPlinth.receiveShadow = true;
  monument.add(mainPlinth);

  // Plinth upper cornice
  const cornice = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  cornice.scale.set(4.1, 0.4, 5.7);
  cornice.position.y = 5.05;
  cornice.castShadow = true;
  monument.add(cornice);

  // Memorial plaque on plinth front
  const plaque = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  plaque.scale.set(2.2, 1.2, 0.08);
  plaque.position.set(0, 3.4, 2.75);
  monument.add(plaque);

  // ── High-Resolution Photographic Cutout Billboard Plates ───────────
  // Cross-plane (0 deg and 90 deg) planes mapped with transparent PNG/WebP cutout
  const cardW = 6.2;
  const cardH = 6.5;
  const cardY = 5.25 + cardH / 2;

  // Plane along horse spine
  const cardZ = new THREE.Mesh(
    new THREE.PlaneGeometry(cardW, cardH),
    M_GORGASALI_CUTOUT,
  );
  cardZ.position.set(0, cardY, 0);
  cardZ.rotation.y = Math.PI / 2;
  cardZ.castShadow = true;
  monument.add(cardZ);

  // Diagonal card 1
  const cardDiag1 = new THREE.Mesh(
    new THREE.PlaneGeometry(cardW * 0.95, cardH),
    M_GORGASALI_CUTOUT,
  );
  cardDiag1.position.set(0, cardY, 0);
  cardDiag1.rotation.y = Math.PI * 0.25;
  monument.add(cardDiag1);

  // Diagonal card 2
  const cardDiag2 = new THREE.Mesh(
    new THREE.PlaneGeometry(cardW * 0.95, cardH),
    M_GORGASALI_CUTOUT,
  );
  cardDiag2.position.set(0, cardY, 0);
  cardDiag2.rotation.y = -Math.PI * 0.25;
  monument.add(cardDiag2);

  // ── Solid 3D Patinated Bronze Volume Core ───────────────────────────
  // Gives real directional lighting and solid shadow casting
  const bronzeCore = new THREE.Group();
  bronzeCore.position.y = 5.25;

  // Horse body
  const horseBody = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horseBody.scale.set(1.4, 1.6, 3.4);
  horseBody.position.set(0, 1.8, 0.1);
  horseBody.castShadow = true;
  bronzeCore.add(horseBody);

  // Horse neck & head
  const horseNeck = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horseNeck.scale.set(0.9, 1.8, 1.3);
  horseNeck.position.set(0, 3.1, 1.5);
  horseNeck.rotation.x = 0.45;
  horseNeck.castShadow = true;
  bronzeCore.add(horseNeck);

  // 4 Legs
  for (const [lx, lz] of [[-0.55, 1.3], [0.55, 1.3], [-0.55, -1.2], [0.55, -1.2]]) {
    const leg = new THREE.Mesh(G_CYL, M_BRONZE_STATUE);
    leg.scale.set(0.28, 2.2, 0.28);
    leg.position.set(lx, 0.9, lz);
    leg.castShadow = true;
    bronzeCore.add(leg);
  }

  // King Vakhtang torso & raised arm
  const kingTorso = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  kingTorso.scale.set(1.2, 1.8, 0.9);
  kingTorso.position.set(0, 3.5, 0.1);
  kingTorso.castShadow = true;
  bronzeCore.add(kingTorso);

  const kingHead = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  kingHead.scale.set(0.8, 0.9, 0.8);
  kingHead.position.set(0, 4.7, 0.1);
  kingHead.castShadow = true;
  bronzeCore.add(kingHead);

  const crown = new THREE.Mesh(G_CYL, M_GOLD_CROSS);
  crown.scale.set(0.85, 0.35, 0.85);
  crown.position.set(0, 5.25, 0.1);
  bronzeCore.add(crown);

  const arm = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  arm.scale.set(1.8, 0.32, 0.32);
  arm.position.set(1.0, 4.1, 0.6);
  arm.rotation.y = 0.4;
  arm.rotation.z = 0.3;
  bronzeCore.add(arm);

  monument.add(bronzeCore);

  return monument;
}

/**
 * 7. Old Tbilisi Houses with Carved Wooden Balconies ("Шушабанди")
 * Authentic Georgian vernacular architecture: solid masonry brick/stone basement,
 * multi-story painted house facade, wide cantilevered wooden balconies with carved
 * turquoise/teal lace fretwork, wooden columns, and terracotta hipped roofs.
 */
function createOldTbilisiHouse(
  x: number, y: number, z: number,
  w: number, d: number, h: number, yaw: number,
  hasTurquoiseBalcony = true,
): THREE.Group {
  const house = new THREE.Group();
  house.position.set(x, y, z);
  house.rotation.y = yaw;

  // 1. Masonry Basement / Lower Floor
  const baseH = h * 0.4;
  const basement = new THREE.Mesh(G_BOX, M_TUFF_WALL);
  basement.scale.set(w, baseH, d);
  basement.position.y = baseH / 2;
  basement.castShadow = true;
  basement.receiveShadow = true;
  house.add(basement);

  // 2. Upper Living Floors (Photographic Georgian House Facade)
  const upperH = h * 0.6;
  const upperBody = new THREE.Mesh(G_BOX, M_HOUSE_FACADE);
  upperBody.scale.set(w * 0.98, upperH, d * 0.98);
  upperBody.position.y = baseH + upperH / 2;
  upperBody.castShadow = true;
  upperBody.receiveShadow = true;
  house.add(upperBody);

  // 3. Cantilevered Carved Wooden Balcony ("Шушабанди")
  if (hasTurquoiseBalcony) {
    const balW = w * 0.88;
    const balH = upperH * 0.72;
    const balD = 2.0;

    // Balcony floor extension
    const balFloor = new THREE.Mesh(G_BOX, M_TUFF_WALL);
    balFloor.scale.set(balW, 0.25, balD);
    balFloor.position.set(0, baseH + 0.12, d / 2 + balD / 2);
    balFloor.castShadow = true;
    house.add(balFloor);

    // Front carved lace wooden panel
    const balFront = new THREE.Mesh(
      new THREE.PlaneGeometry(balW, balH),
      M_BALCONY_FACADE,
    );
    balFront.position.set(0, baseH + balH / 2 + 0.2, d / 2 + balD);
    balFront.castShadow = true;
    house.add(balFront);

    // Left and right side panels
    for (const side of [-1, 1]) {
      const balSide = new THREE.Mesh(
        new THREE.PlaneGeometry(balD, balH),
        M_BALCONY_FACADE,
      );
      balSide.position.set(side * (balW / 2), baseH + balH / 2 + 0.2, d / 2 + balD / 2);
      balSide.rotation.y = side * Math.PI / 2;
      house.add(balSide);

      // Wooden support corbel brackets underneath
      const corbel = new THREE.Mesh(G_BOX, M_TREE_TRUNK);
      corbel.scale.set(0.25, 1.2, balD);
      corbel.position.set(side * (balW / 2 - 0.3), baseH - 0.5, d / 2 + balD / 2);
      corbel.rotation.x = 0.35;
      house.add(corbel);
    }
  }

  // 4. Hipped Overhanging Roof with Terracotta Barrel Tiles
  const roofOverhang = 0.8;
  const roofW = w + roofOverhang * 2;
  const roofD = d + roofOverhang * 2 + (hasTurquoiseBalcony ? 1.8 : 0);
  const roofH = 2.2;

  // Sloping roof geometry using four pitched segments
  for (const [sign, rot] of [[-1, 0.48], [1, -0.48]]) {
    const roofSlope = new THREE.Mesh(G_BOX, M_ROOF_TILES);
    roofSlope.scale.set(roofW * 0.54, 0.25, roofD);
    roofSlope.position.set(sign * (roofW * 0.25), h + roofH * 0.45, (hasTurquoiseBalcony ? 0.9 : 0));
    roofSlope.rotation.z = rot;
    roofSlope.castShadow = true;
    house.add(roofSlope);
  }

  return house;
}

/**
 * 8. Old Tbilisi Traditional Quarters
 * Houses placed along the Metekhi cliffside, Meidan square, and Wine Ascent.
 */
function createOldTbilisiQuarters(): THREE.Group {
  const quarters = new THREE.Group();

  const houses = [
    // Metekhi Cliffside (promontory overlooking river)
    { x: 1855, y: 26.5, z: 480, w: 12, d: 10, h: 9.0, yaw: 0.1, balcony: true },
    { x: 1895, y: 25.5, z: 465, w: 14, d: 11, h: 9.5, yaw: -0.2, balcony: true },
    { x: 1860, y: 24.5, z: 545, w: 13, d: 10, h: 8.5, yaw: 0.35, balcony: true },

    // Meidan / Gorgasali Square (West Bank bridgehead)
    { x: 1835, y: 14.5, z: 575, w: 14, d: 12, h: 8.5, yaw: -0.6, balcony: true },
    { x: 1845, y: 14.5, z: 525, w: 16, d: 12, h: 9.0, yaw: -0.4, balcony: true },
    { x: 1820, y: 14.5, z: 545, w: 15, d: 14, h: 8.5, yaw: -0.5, balcony: false },

    // Wine Ascent (Ghvini Agmarti) climbing east from Europe Square
    { x: 1980, y: 15.0, z: 660, w: 14, d: 11, h: 8.0, yaw: 0.4, balcony: true },
    { x: 1995, y: 15.5, z: 630, w: 15, d: 12, h: 8.5, yaw: 0.35, balcony: true },
    { x: 1970, y: 16.0, z: 570, w: 14, d: 10, h: 8.0, yaw: -0.1, balcony: true },
  ];

  for (const h of houses) {
    quarters.add(createOldTbilisiHouse(h.x, h.y, h.z, h.w, h.d, h.h, h.yaw, h.balcony));
  }

  return quarters;
}

/**
 * 9. Authentic Italian Cypress Trees & Caucasian Flora
 * Tall slender dark green cypresses iconic to Metekhi church and Tbilisi hillsides.
 */
function createCypressTree(x: number, y: number, z: number, height = 11): THREE.Group {
  const tree = new THREE.Group();
  tree.position.set(x, y, z);

  // Trunk
  const trunk = new THREE.Mesh(G_CYL, M_TREE_TRUNK);
  trunk.scale.set(0.35, height * 0.28, 0.35);
  trunk.position.y = height * 0.14;
  trunk.castShadow = true;
  tree.add(trunk);

  // Tiered slender conical evergreen foliage
  const foliageTiers = [
    { y: height * 0.32, h: height * 0.45, r: 1.2 },
    { y: height * 0.52, h: height * 0.42, r: 1.0 },
    { y: height * 0.72, h: height * 0.38, r: 0.75 },
    { y: height * 0.88, h: height * 0.28, r: 0.45 },
  ];

  for (const tier of foliageTiers) {
    const cone = new THREE.Mesh(G_CONE, M_CYPRESS_FOLIAGE);
    cone.scale.set(tier.r * 2, tier.h, tier.r * 2);
    cone.position.y = tier.y;
    cone.castShadow = true;
    tree.add(cone);
  }

  return tree;
}

/**
 * Broad Leafy Plane Tree for Rike Park & River Promenades
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
 * Clusters of authentic vegetation around Metekhi Church and Europe Square.
 */
function createVegetation(heightAt: (x: number, z: number) => number): THREE.Group {
  const veg = new THREE.Group();

  // Cypresses in Metekhi Church courtyard atop the cliff
  const churchCypresses = [
    { x: 1870, z: 485, h: 12 },
    { x: 1895, z: 512, h: 11 },
    { x: 1865, z: 510, h: 13 },
    { x: 1888, z: 478, h: 10 },
    { x: 1858, z: 495, h: 12 },
  ];
  for (const c of churchCypresses) {
    const y = heightAt(c.x, c.z);
    veg.add(createCypressTree(c.x, y, c.z, c.h));
  }

  // Cypresses and plane trees along Rike Park promenade
  const parkTrees = [
    { x: 1930, z: 540, h: 10, type: 'cypress' },
    { x: 1945, z: 520, h: 9, type: 'plane' },
    { x: 1920, z: 490, h: 11, type: 'cypress' },
    { x: 1935, z: 460, h: 9, type: 'plane' },
    { x: 1955, z: 440, h: 10, type: 'cypress' },
    { x: 1910, z: 420, h: 8, type: 'plane' },
  ];
  for (const t of parkTrees) {
    const y = heightAt(t.x, t.z);
    if (t.type === 'cypress') veg.add(createCypressTree(t.x, y, t.z, t.h));
    else veg.add(createPlaneTree(t.x, y, t.z, t.h));
  }

  return veg;
}

/**
 * 10. Emerald Kura River (Река Кура / Мтквари)
 * Rich emerald water flowing through the canyon between vertical stone quays.
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
 * 11. Bridge of Peace (Мост Мира)
 * Modern waving glass and steel canopy pedestrian bridge.
 */
function createBridgeOfPeace(): THREE.Group {
  const bridge = new THREE.Group();
  const start = TBILISI_PEACE_BRIDGE.start;
  const end = TBILISI_PEACE_BRIDGE.end;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const midX = (start.x + end.x) / 2;
  const midZ = (start.z + end.z) / 2;
  const w = TBILISI_PEACE_BRIDGE.width;

  bridge.position.set(midX, TBILISI_PEACE_BRIDGE.deckElevation, midZ);
  bridge.rotation.y = yaw;

  // Pedestrian bridge deck
  const deck = new THREE.Mesh(G_BOX, M_STEEL_STRUCTURE);
  deck.scale.set(w * 0.7, 0.4, len);
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);

  // Glass canopy arch
  const canopy = new THREE.Mesh(G_CYL, M_CANOPY_GLASS);
  canopy.scale.set(w * 1.1, len * 0.95, w * 0.7);
  canopy.rotation.x = Math.PI / 2;
  canopy.position.y = 3.6;
  bridge.add(canopy);

  // Steel framework ribs
  for (let t = -0.4; t <= 0.4; t += 0.1) {
    const rib = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    rib.scale.set(w * 1.12, 0.25, w * 0.72);
    rib.rotation.x = Math.PI / 2;
    rib.position.set(0, 3.6, t * len);
    bridge.add(rib);
  }

  return bridge;
}

/**
 * Builds and returns the complete photorealistic Tbilisi Europe Square district.
 */
export function buildTbilisiDistrict(heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tbilisi-district';

  // 1. Satellite Orthophoto Ground
  group.add(createOrthophotoGround(heightAt));

  // 2. Europe Square Roundabout & Plazas
  group.add(createEuropeSquare(heightAt));

  // 3. Metekhi Bridge across the Kura
  group.add(createMetekhiBridge());

  // 4. Metekhi Cliff & Fortress Retaining Wall
  group.add(createMetekhiCliff(heightAt));

  // 5. Metekhi Church of the Dormition
  group.add(createMetekhiChurch());

  // 6. King Vakhtang Gorgasali Equestrian Monument
  group.add(createGorgasaliMonument());

  // 7. Old Tbilisi Traditional Houses with Carved Balconies
  group.add(createOldTbilisiQuarters());

  // 8. Italian Cypresses & Trees
  group.add(createVegetation(heightAt));

  // 9. Emerald Kura River Water
  group.add(createKuraRiverWater());

  // 10. Bridge of Peace
  group.add(createBridgeOfPeace());

  return group;
}
