// src/render/tbilisi/tbilisiLandmarks.ts
// Photorealistic 3D architectural landmarks and satellite orthophoto ground for Tbilisi Europe Square.
import * as THREE from 'three';
import satOrthophotoUrl from '../../assets/tbilisi/europe_square_sat.webp';
import {
  TBILISI_CENTER, TBILISI_ORTHO_BOUNDS, TBILISI_METEKHI_BRIDGE,
  TBILISI_METEKHI_CHURCH, TBILISI_GORGASALI_STATUE,
  TBILISI_PEACE_BRIDGE, TBILISI_KURA_LINE, TBILISI_KURA_RIVER,
  TBILISI_ROUNDABOUT,
} from '../../world/tbilisi/tbilisiDef';

// Reusable unit geometry
const G_BOX = new THREE.BoxGeometry(1, 1, 1);
const G_CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
const G_CONE = new THREE.ConeGeometry(0.5, 1, 16);

// PBR Materials
const M_ASPHALT = new THREE.MeshStandardMaterial({
  color: 0x2e3033,
  roughness: 0.82,
  metalness: 0.08,
});

const M_YELLOW_LINE = new THREE.MeshStandardMaterial({
  color: 0xf5b027,
  roughness: 0.55,
  metalness: 0.05,
});

const M_CONCRETE_CURB = new THREE.MeshStandardMaterial({
  color: 0x8a8e94,
  roughness: 0.9,
  metalness: 0.05,
});

const M_STONE_WALL = new THREE.MeshStandardMaterial({
  color: 0x6e685f,
  roughness: 0.92,
  metalness: 0.05,
});

const M_GEORGIAN_TUFF = new THREE.MeshStandardMaterial({
  color: 0xb58c5c,
  roughness: 0.88,
  metalness: 0.05,
});

const M_TERRACOTTA_TILE = new THREE.MeshStandardMaterial({
  color: 0x8e3828,
  roughness: 0.85,
  metalness: 0.05,
});

const M_GOLD_CROSS = new THREE.MeshStandardMaterial({
  color: 0xffcb3d,
  roughness: 0.25,
  metalness: 0.85,
});

const M_BRONZE_STATUE = new THREE.MeshStandardMaterial({
  color: 0x2e3b35,
  roughness: 0.38,
  metalness: 0.75,
});

const M_DARK_BASALT = new THREE.MeshStandardMaterial({
  color: 0x2b2926,
  roughness: 0.75,
  metalness: 0.1,
});

const M_CANOPY_GLASS = new THREE.MeshStandardMaterial({
  color: 0x88d4e8,
  transparent: true,
  opacity: 0.65,
  roughness: 0.1,
  metalness: 0.6,
  side: THREE.DoubleSide,
});

const M_STEEL_STRUCTURE = new THREE.MeshStandardMaterial({
  color: 0xccd4db,
  roughness: 0.35,
  metalness: 0.8,
});

const M_KURA_WATER = new THREE.MeshStandardMaterial({
  color: 0x2f6b5b,
  roughness: 0.15,
  metalness: 0.45,
  transparent: true,
  opacity: 0.92,
});

const M_LAMP_GLOW = new THREE.MeshBasicMaterial({
  color: 0xffe6a3,
});

/**
 * 1. Satellite Orthophoto Ground Overlay
 * Drapes the high-resolution aerial imagery over the Europe Square district.
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
    // Slight offset (+0.06m) to prevent z-fighting with procedural terrain
    pos.setY(i, groundY + 0.06);
  }
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  const texture = new THREE.TextureLoader().load(satOrthophotoUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.88,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(cx, 0, cz);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 2. Metekhi Bridge (Мост Метехи)
 * Spans across the Kura river with road deck, sidewalks, balustrades, piers, and lanterns.
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

  // Road asphalt deck
  const deck = new THREE.Mesh(G_BOX, M_ASPHALT);
  deck.scale.set(w - 3.6, 0.9, len);
  deck.position.y = -0.45;
  deck.castShadow = true;
  deck.receiveShadow = true;
  bridge.add(deck);

  // Road lines
  const centerLine = new THREE.Mesh(G_BOX, M_YELLOW_LINE);
  centerLine.scale.set(0.24, 0.02, len);
  centerLine.position.y = 0.01;
  bridge.add(centerLine);

  // Left & right sidewalks
  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(G_BOX, M_CONCRETE_CURB);
    sidewalk.scale.set(1.8, 0.25, len);
    sidewalk.position.set(side * (w / 2 - 0.9), 0.12, 0);
    sidewalk.receiveShadow = true;
    bridge.add(sidewalk);

    // Stone balustrade / parapet
    const parapet = new THREE.Mesh(G_BOX, M_STONE_WALL);
    parapet.scale.set(0.38, 1.1, len);
    parapet.position.set(side * (w / 2 - 0.2), 0.7, 0);
    parapet.castShadow = true;
    bridge.add(parapet);

    // Handrail top
    const railTop = new THREE.Mesh(G_BOX, M_STONE_WALL);
    railTop.scale.set(0.55, 0.15, len);
    railTop.position.set(side * (w / 2 - 0.2), 1.3, 0);
    bridge.add(railTop);
  }

  // Massive concrete/stone bridge piers into the river
  for (const t of [-0.25, 0.25]) {
    const pier = new THREE.Mesh(G_BOX, M_STONE_WALL);
    pier.scale.set(w * 0.9, 12, 5.5);
    pier.position.set(0, -6, t * len);
    pier.castShadow = true;
    pier.receiveShadow = true;
    bridge.add(pier);
  }

  // Classic street light posts with lanterns
  for (const zOff of [-0.35, -0.12, 0.12, 0.35]) {
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
      pole.scale.set(0.18, 4.2, 0.18);
      pole.position.set(side * (w / 2 - 0.2), 2.8, zOff * len);
      bridge.add(pole);

      const lantern = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
      lantern.scale.set(0.45, 0.55, 0.45);
      lantern.position.set(side * (w / 2 - 0.2), 4.8, zOff * len);
      bridge.add(lantern);
    }
  }

  return bridge;
}

/**
 * 3. Metekhi Church (Церковь Метехи)
 * Famous 13th-century cross-cupola church atop the Metekhi cliff.
 */
function createMetekhiChurch(): THREE.Group {
  const church = new THREE.Group();
  church.position.set(TBILISI_METEKHI_CHURCH.pos.x, TBILISI_METEKHI_CHURCH.pos.y, TBILISI_METEKHI_CHURCH.pos.z);
  church.rotation.y = TBILISI_METEKHI_CHURCH.yaw;

  // Cruciform stone nave and transept
  const mainNave = new THREE.Mesh(G_BOX, M_GEORGIAN_TUFF);
  mainNave.scale.set(14, 11, 24);
  mainNave.position.y = 5.5;
  mainNave.castShadow = true;
  mainNave.receiveShadow = true;
  church.add(mainNave);

  const transept = new THREE.Mesh(G_BOX, M_GEORGIAN_TUFF);
  transept.scale.set(20, 10.5, 12);
  transept.position.y = 5.25;
  transept.castShadow = true;
  transept.receiveShadow = true;
  church.add(transept);

  // Terracotta pitched gable roofs
  const roofNaveL = new THREE.Mesh(G_BOX, M_TERRACOTTA_TILE);
  roofNaveL.scale.set(7.5, 0.25, 24.5);
  roofNaveL.position.set(-3.6, 12.5, 0);
  roofNaveL.rotation.z = 0.55;
  church.add(roofNaveL);

  const roofNaveR = new THREE.Mesh(G_BOX, M_TERRACOTTA_TILE);
  roofNaveR.scale.set(7.5, 0.25, 24.5);
  roofNaveR.position.set(3.6, 12.5, 0);
  roofNaveR.rotation.z = -0.55;
  church.add(roofNaveR);

  // Central cylindrical drum with tall arched Georgian windows
  const drum = new THREE.Mesh(G_CYL, M_GEORGIAN_TUFF);
  drum.scale.set(6.8, 6.5, 6.8);
  drum.position.y = 14.5;
  drum.castShadow = true;
  church.add(drum);

  // Characteristic Georgian conical stone umbrella roof
  const coneRoof = new THREE.Mesh(G_CONE, M_TERRACOTTA_TILE);
  coneRoof.scale.set(7.6, 6.8, 7.6);
  coneRoof.position.y = 20.8;
  coneRoof.castShadow = true;
  church.add(coneRoof);

  // Golden cross atop the conical dome
  const crossV = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossV.scale.set(0.18, 2.4, 0.18);
  crossV.position.y = 25.2;
  church.add(crossV);

  const crossH = new THREE.Mesh(G_BOX, M_GOLD_CROSS);
  crossH.scale.set(1.4, 0.18, 0.18);
  crossH.position.y = 25.6;
  church.add(crossH);

  return church;
}

/**
 * 4. King Vakhtang Gorgasali Monument (Памятник Вахтангу Горгасали)
 * Bronze equestrian statue on the cliff edge overlook.
 */
function createGorgasaliMonument(): THREE.Group {
  const monument = new THREE.Group();
  monument.position.set(TBILISI_GORGASALI_STATUE.pos.x, TBILISI_GORGASALI_STATUE.pos.y, TBILISI_GORGASALI_STATUE.pos.z);
  monument.rotation.y = TBILISI_GORGASALI_STATUE.yaw;

  // Stepped dark basalt plinth pedestal
  const baseStep = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  baseStep.scale.set(5.5, 0.6, 7.5);
  baseStep.position.y = 0.3;
  baseStep.castShadow = true;
  monument.add(baseStep);

  const mainPlinth = new THREE.Mesh(G_BOX, M_DARK_BASALT);
  mainPlinth.scale.set(3.8, 4.2, 5.8);
  mainPlinth.position.y = 2.7;
  mainPlinth.castShadow = true;
  monument.add(mainPlinth);

  // Bronze Horse
  const horseBody = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horseBody.scale.set(1.4, 1.6, 3.4);
  horseBody.position.set(0, 5.8, 0.2);
  horseBody.rotation.x = -0.15;
  horseBody.castShadow = true;
  monument.add(horseBody);

  const horseNeck = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horseNeck.scale.set(1.0, 1.8, 1.2);
  horseNeck.position.set(0, 7.2, 1.6);
  horseNeck.rotation.x = 0.45;
  horseNeck.castShadow = true;
  monument.add(horseNeck);

  const horseHead = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  horseHead.scale.set(0.7, 0.8, 1.4);
  horseHead.position.set(0, 8.1, 2.1);
  monument.add(horseHead);

  // 4 Legs
  for (const [lx, lz, angle] of [[-0.55, 1.4, 0.2], [0.55, 1.4, -0.1], [-0.55, -1.2, -0.1], [0.55, -1.2, 0.15]]) {
    const leg = new THREE.Mesh(G_CYL, M_BRONZE_STATUE);
    leg.scale.set(0.3, 2.4, 0.3);
    leg.position.set(lx, 4.4, lz);
    leg.rotation.z = angle;
    monument.add(leg);
  }

  // King Vakhtang Gorgasali Rider
  const torso = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  torso.scale.set(1.2, 1.8, 0.9);
  torso.position.set(0, 7.5, 0.2);
  torso.castShadow = true;
  monument.add(torso);

  const head = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  head.scale.set(0.8, 0.9, 0.8);
  head.position.set(0, 8.8, 0.2);
  monument.add(head);

  // Crown
  const crown = new THREE.Mesh(G_CYL, M_GOLD_CROSS);
  crown.scale.set(0.85, 0.4, 0.85);
  crown.position.set(0, 9.3, 0.2);
  monument.add(crown);

  // Outstretched right arm pointing across the city
  const arm = new THREE.Mesh(G_BOX, M_BRONZE_STATUE);
  arm.scale.set(1.8, 0.35, 0.35);
  arm.position.set(1.1, 8.2, 0.8);
  arm.rotation.y = 0.5;
  arm.rotation.z = 0.3;
  monument.add(arm);

  return monument;
}

/**
 * 5. Bridge of Peace (Мост Мира)
 * Modern waving glass and steel canopy bridge across the Kura.
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
 * 6. Rike Park Concert Hall (Трубы Рике)
 * Massimiliano Fuksas's iconic dual metallic/glass architectural tubes.
 */
function createRikeParkTubes(): THREE.Group {
  const tubes = new THREE.Group();
  tubes.position.set(1015, 14.5, 1665);
  tubes.rotation.y = -0.55;

  // Tube 1 (Lower Auditorium)
  const tube1 = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
  tube1.scale.set(13, 44, 11);
  tube1.rotation.x = Math.PI / 2;
  tube1.position.set(-6, 5, 0);
  tube1.castShadow = true;
  tubes.add(tube1);

  const glass1 = new THREE.Mesh(G_CYL, M_CANOPY_GLASS);
  glass1.scale.set(12.6, 0.4, 10.6);
  glass1.position.set(-6, 5, 22);
  glass1.rotation.x = Math.PI / 2;
  tubes.add(glass1);

  // Tube 2 (Upper Exhibition Hall)
  const tube2 = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
  tube2.scale.set(12, 40, 10);
  tube2.rotation.x = Math.PI / 2;
  tube2.position.set(8, 8, -4);
  tube2.castShadow = true;
  tubes.add(tube2);

  const glass2 = new THREE.Mesh(G_CYL, M_CANOPY_GLASS);
  glass2.scale.set(11.6, 0.4, 9.6);
  glass2.position.set(8, 8, 16);
  glass2.rotation.x = Math.PI / 2;
  tubes.add(glass2);

  return tubes;
}

/**
 * 7. Kura River Water Plane (Река Кура)
 * Beautiful emerald water surface flowing through the gorge.
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
    segment.scale.set(TBILISI_KURA_RIVER.halfWidth * 2.2, 0.2, len + 2);
    segment.position.set((a.x + b.x) / 2, TBILISI_KURA_RIVER.waterElevation, (a.z + b.z) / 2);
    segment.rotation.y = yaw;
    waterGroup.add(segment);
  }

  return waterGroup;
}

/**
 * 8. Europe Square Perimeter Street Lanterns & Roundabout Island
 */
function createEuropeSquareDetails(): THREE.Group {
  const details = new THREE.Group();
  const rb = TBILISI_ROUNDABOUT;

  // Central flower garden monument in roundabout
  const monumentBase = new THREE.Mesh(G_CYL, M_STONE_WALL);
  monumentBase.scale.set(4.5, 1.2, 4.5);
  monumentBase.position.set(rb.center.x, rb.roadElevation + 0.6, rb.center.z);
  monumentBase.castShadow = true;
  details.add(monumentBase);

  const monumentColumn = new THREE.Mesh(G_CYL, M_GEORGIAN_TUFF);
  monumentColumn.scale.set(1.4, 5.5, 1.4);
  monumentColumn.position.set(rb.center.x, rb.roadElevation + 3.8, rb.center.z);
  monumentColumn.castShadow = true;
  details.add(monumentColumn);

  // Lanterns around Europe Square circle
  const count = 8;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const lx = rb.center.x + Math.cos(angle) * (rb.outerRadius + 1.5);
    const lz = rb.center.z + Math.sin(angle) * (rb.outerRadius + 1.5);

    const pole = new THREE.Mesh(G_CYL, M_STEEL_STRUCTURE);
    pole.scale.set(0.18, 4.0, 0.18);
    pole.position.set(lx, rb.roadElevation + 2.0, lz);
    details.add(pole);

    const lamp = new THREE.Mesh(G_BOX, M_LAMP_GLOW);
    lamp.scale.set(0.4, 0.45, 0.4);
    lamp.position.set(lx, rb.roadElevation + 4.2, lz);
    details.add(lamp);
  }

  return details;
}

/**
 * Builds and returns the complete Tbilisi Europe Square district.
 */
export function buildTbilisiDistrict(heightAt: (x: number, z: number) => number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'tbilisi-district';

  // 1. Satellite Orthophoto ground draped over the 3D relief
  group.add(createOrthophotoGround(heightAt));

  // 2. Metekhi Bridge across the Kura
  group.add(createMetekhiBridge());

  // 3. Metekhi Church atop the cliff
  group.add(createMetekhiChurch());

  // 4. King Vakhtang Gorgasali equestrian monument
  group.add(createGorgasaliMonument());

  // 5. Bridge of Peace
  group.add(createBridgeOfPeace());

  // 6. Rike Park Concert Hall tubes
  group.add(createRikeParkTubes());

  // 7. Kura River water surface
  group.add(createKuraRiverWater());

  // 8. Europe Square details & lanterns
  group.add(createEuropeSquareDetails());

  return group;
}
