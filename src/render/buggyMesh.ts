import * as THREE from 'three';
import { makeToonMaterial } from './celShading';
import { vehicleConfig as cfg } from '../vehicle/vehicleConfig';

// ── Pajero Sport palette ──────────────────────────────────────────────
const BODY = 0x787c84; // charcoal grey (lightened so toon shading still reads grey, not black)
const GLASS = 0x1d2530; // tinted glass
const BLACK = 0x141414; // trim / cladding / bumpers / tyres
const CHROME = 0xb9bcc2; // chrome / alloy / rails
const HEAD = 0xfff2cf; // pale headlights
const TAIL = 0x7a1410; // red tail lights

// ── tiny primitive helpers ────────────────────────────────────────────
function box(w: number, h: number, d: number, color: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), makeToonMaterial(color));
}

function cyl(radius: number, len: number, color: number, segments = 16): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, len, segments),
    makeToonMaterial(color),
  );
}

function put(mesh: THREE.Object3D, x: number, y: number, z: number): THREE.Object3D {
  mesh.position.set(x, y, z);
  return mesh;
}

// ── BODY: chassis, glasshouse, trim, lights, mirrors, steps ───────────
function buildBody(): THREE.Group {
  const g = new THREE.Group();
  const add = (m: THREE.Object3D): void => {
    g.add(m);
  };

  // Main hull / belt line (charcoal). Front faces +Z.
  add(put(box(1.9, 0.6, 3.9, BODY), 0, 0.05, 0));

  // Two-tone lower black cladding wrapping the sills / lower doors.
  add(put(box(1.96, 0.3, 3.95, BLACK), 0, -0.18, 0));

  // Long hood, sloping gently up toward the windshield base.
  const hood = box(1.74, 0.16, 1.55, BODY);
  hood.rotation.x = -0.04;
  add(put(hood, 0, 0.42, 1.15));

  // Greenhouse core block that the glass & pillars dress.
  add(put(box(1.5, 0.72, 1.95, BODY), 0, 0.86, -0.5));

  // Raked windshield (wedge box leaning back toward the roof).
  const wind = box(1.58, 0.95, 0.1, GLASS);
  wind.rotation.x = -0.52;
  add(put(wind, 0, 0.82, 0.32));

  // Roof, descending slightly toward the rear.
  const roof = box(1.5, 0.14, 1.85, BODY);
  roof.rotation.x = 0.04;
  add(put(roof, 0, 1.2, -0.55));

  // Raked rear backlight glass.
  const rear = box(1.42, 0.58, 0.1, GLASS);
  rear.rotation.x = 0.36;
  add(put(rear, 0, 0.96, -1.5));

  // Rear hatch / lower tailgate face.
  add(put(box(1.72, 0.62, 0.22, BODY), 0, 0.5, -1.95));

  // Symmetric side detail (left = -1, right = +1).
  for (const s of [-1, 1]) {
    const x = 0.78 * s;

    // Front & rear side windows (tinted), split by a body-colour B-pillar.
    add(put(box(0.06, 0.42, 0.74, GLASS), x, 0.86, 0.05));
    add(put(box(0.06, 0.42, 0.66, GLASS), x, 0.86, -0.78));
    add(put(box(0.08, 0.64, 0.12, BODY), x + 0.005 * s, 0.86, -0.36)); // B-pillar
    add(put(box(0.08, 0.64, 0.14, BODY), x + 0.005 * s, 0.9, -1.18)); // C-pillar

    // Distinctive kicked-up rear quarter window.
    const quarter = box(0.06, 0.3, 0.34, GLASS);
    quarter.rotation.x = 0.5;
    add(put(quarter, x, 0.96, -1.42));

    // Silver roof rail along the top edge.
    add(put(box(0.08, 0.07, 1.7, CHROME), 0.66 * s, 1.29, -0.55));

    // Blacked-out wheel-arch flares around each axle.
    add(put(box(0.5, 0.52, 1.02, BLACK), 0.95 * s, -0.1, 1.4));
    add(put(box(0.5, 0.52, 1.02, BLACK), 0.95 * s, -0.1, -1.4));

    // Running board / side step along the sill.
    add(put(box(0.2, 0.1, 2.1, BLACK), 0.93 * s, -0.34, 0));

    // Side mirror on a stalk.
    add(put(box(0.14, 0.05, 0.06, BODY), 0.96 * s, 0.72, 0.42)); // stalk
    add(put(box(0.07, 0.18, 0.22, BLACK), 1.06 * s, 0.74, 0.42)); // housing

    // Headlights (front, +Z) and tail lights (rear, -Z).
    add(put(box(0.42, 0.22, 0.1, HEAD), 0.66 * s, 0.34, 2.0));
    add(put(box(0.32, 0.34, 0.1, TAIL), 0.72 * s, 0.52, -1.99));
  }

  // ── Front face: grille, bumper, skid plate, chrome bull bar ─────────
  add(put(box(1.22, 0.36, 0.12, BLACK), 0, 0.26, 2.0)); // grille recess
  add(put(box(1.0, 0.05, 0.14, CHROME), 0, 0.34, 2.02)); // grille bar
  add(put(box(1.0, 0.05, 0.14, CHROME), 0, 0.2, 2.02)); // grille bar
  add(put(box(1.84, 0.4, 0.3, BLACK), 0, -0.06, 2.02)); // front bumper
  add(put(box(1.24, 0.18, 0.26, CHROME), 0, -0.24, 2.06)); // skid plate
  add(put(box(1.7, 0.5, 0.26, BLACK), 0, 0.5, -2.0)); // rear bumper

  // Chrome tubular bull bar standing proud of the grille.
  const barLo = cyl(0.045, 1.4, CHROME);
  barLo.rotation.z = Math.PI / 2;
  add(put(barLo, 0, 0.16, 2.2)); // lower cross tube
  const barHi = cyl(0.045, 1.2, CHROME);
  barHi.rotation.z = Math.PI / 2;
  add(put(barHi, 0, 0.42, 2.2)); // upper cross tube
  for (const s of [-1, 1]) {
    add(put(cyl(0.045, 0.5, CHROME), 0.6 * s, 0.29, 2.2)); // vertical uprights
  }

  g.position.y = -0.02; // settle the body onto the wheels
  return g;
}

// ── WHEEL: tyre + silver alloy rim/spokes on a pivot→spinner rig ───────
function buildWheel(p: { x: number; y: number; z: number }): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(p.x, p.y, p.z);

  const spinner = new THREE.Group();
  pivot.add(spinner);

  // Tyre — axle along X.
  const tyre = new THREE.Mesh(
    new THREE.CylinderGeometry(cfg.wheel.radius, cfg.wheel.radius, cfg.wheel.width, 20),
    makeToonMaterial(BLACK),
  );
  tyre.rotation.z = Math.PI / 2;
  spinner.add(tyre);

  // Alloy rim face.
  const rim = cyl(cfg.wheel.radius * 0.62, cfg.wheel.width * 1.02, CHROME, 20);
  rim.rotation.z = Math.PI / 2;
  spinner.add(rim);

  // Central hub cap.
  const hub = cyl(cfg.wheel.radius * 0.2, cfg.wheel.width * 1.06, CHROME, 12);
  hub.rotation.z = Math.PI / 2;
  spinner.add(hub);

  // A few crossing silver spokes (rotate around the X axle).
  for (let i = 0; i < 3; i++) {
    const spoke = box(cfg.wheel.width * 0.9, 0.08, cfg.wheel.radius * 1.1, CHROME);
    spoke.rotation.x = (i * Math.PI) / 3;
    spinner.add(spoke);
  }

  return pivot;
}

/**
 * Low-poly cel-shaded Mitsubishi Pajero Sport (2020, charcoal grey).
 * Front is +Z. Layout is [bodyGroup, wheelPivot0..3] so the physics Buggy reads
 * children[0] as the body and children.slice(1) as the four wheel pivots; each
 * pivot steers via yaw and holds a spinner (rolls around local X) holding the tyre.
 */
export function buildBuggyMesh(): THREE.Group {
  const group = new THREE.Group();

  // children[0] = chassis / body.
  group.add(buildBody());

  // children[1..4] = wheel pivots in cfg order.
  for (const p of cfg.wheel.positions) {
    group.add(buildWheel(p));
  }

  return group;
}