// src/ui/minimap.ts
// The HUD minimap: displays the Klipfontein desert landscape with topographical relief,
// roads, landmarks, and positions of the local player and other players in real-time.
// Supports local radar mode (tracking car with heading/north-up) and expanded full map mode.

import { MAP_SIZE, ROUTES, DAM, SOUTPAN, MAP_LANDMARKS, BOSVELD, DORP_YARD } from '../world/mapLayout';
import { COVER, coverFromIndex } from '../world/biome';
import type { FarGrid } from '../world/farGrid';
import type { CarId } from '../vehicle/cars';

export const MINIMAP_WORLD_SIZE = MAP_SIZE;

/** Radar zoom levels in world metres (radius visible from car to edge). */
export const RADAR_ZOOM_LEVELS = [350, 650, 1200] as const;
export type RadarZoom = (typeof RADAR_ZOOM_LEVELS)[number];
export const DEFAULT_RADAR_ZOOM: RadarZoom = 650;

export interface MinimapLocalPose {
  x: number;
  z: number;
  forwardX: number;
  forwardZ: number;
}

export interface MinimapRemotePlayer {
  id: string;
  name: string;
  carId: CarId | string;
  x: number;
  z: number;
  heading?: number;
}

export interface ProjectedPoint {
  /** Pixel coordinate relative to radar center. */
  x: number;
  y: number;
  /** Distance in world metres. */
  distanceMeters: number;
  /** True if the point lies outside the radar radius and is clamped to the edge. */
  isOffscreen: boolean;
  /** Angle in screen space from center, radians. */
  angleRad: number;
}

/** Converts world coordinates [0, WORLD_SIZE] into normalized UV coordinates [0, 1]. */
export function worldToMapUV(x: number, z: number, worldSize = MINIMAP_WORLD_SIZE): { u: number; v: number } {
  return {
    u: Math.max(0, Math.min(1, x / worldSize)),
    v: Math.max(0, Math.min(1, z / worldSize)),
  };
}

/** Formats a distance in metres to human-readable string (e.g. "450 м" or "1.2 км"). */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} м`;
  }
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} км`;
}

/** Calculates the heading angle in radians from a horizontal forward vector (0 is North -z, π/2 is East +x). */
export function carHeadingAngle(forwardX: number, forwardZ: number): number {
  if (forwardX === 0 && forwardZ === 0) return 0;
  const angle = Math.atan2(forwardX, -forwardZ);
  const twoPi = Math.PI * 2;
  return ((angle % twoPi) + twoPi) % twoPi;
}

/**
 * Projects a target world coordinate onto the local radar screen.
 * When `headingUp` is true, the car's forward direction points toward the top of the screen (-y).
 * If the target exceeds `radarRadiusPx`, it is clamped to the radar boundary (`isOffscreen = true`).
 */
export function projectToRadar(
  carX: number,
  carZ: number,
  headingRad: number,
  targetX: number,
  targetZ: number,
  viewRadiusMeters: number,
  radarRadiusPx: number,
  headingUp: boolean,
): ProjectedPoint {
  const dx = targetX - carX;
  const dz = targetZ - carZ;
  const distanceMeters = Math.hypot(dx, dz);
  const scale = radarRadiusPx / viewRadiusMeters;

  let localX: number;
  let localY: number;

  if (headingUp) {
    // Relative to car heading (UP is forward, RIGHT is right)
    const sin = Math.sin(headingRad);
    const cos = Math.cos(headingRad);
    const right = dx * cos + dz * sin;
    const forward = dx * sin - dz * cos;
    localX = right * scale;
    localY = -forward * scale;
  } else {
    // North is UP (-z on screen is -y)
    localX = dx * scale;
    localY = dz * scale;
  }

  const screenDistance = Math.hypot(localX, localY);
  const angleRad = Math.atan2(localY, localX);

  if (screenDistance <= radarRadiusPx) {
    return {
      x: localX,
      y: localY,
      distanceMeters,
      isOffscreen: false,
      angleRad,
    };
  }

  return {
    x: Math.cos(angleRad) * radarRadiusPx,
    y: Math.sin(angleRad) * radarRadiusPx,
    distanceMeters,
    isOffscreen: true,
    angleRad,
  };
}

/** Car-specific distinctive marker colors for quick player recognition. */
export const CAR_MARKER_COLORS: Readonly<Record<string, string>> = {
  forester: '#38bdf8', // sky blue
  pajero: '#4ade80',   // vibrant green
  elantra: '#fb7185',  // rose pink
};

export function markerColorForCar(carId: string): string {
  return CAR_MARKER_COLORS[carId.toLowerCase()] ?? '#facc15';
}

/** Unpacks a 24-bit hex color into RGB components. */
function hexToRgb(hex: number): { r: number; g: number; b: number } {
  return {
    r: (hex >> 16) & 0xff,
    g: (hex >> 8) & 0xff,
    b: hex & 0xff,
  };
}

/**
 * Pre-renders the full Klipfontein landscape with topographical hillshading,
 * biome colors, roads, riverbed, water bodies, and landmarks into an offscreen canvas.
 */
export function bakeTerrainCanvas(grid: FarGrid, textureSize = 512): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = textureSize;
  canvas.height = textureSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const { originX, originZ, step, verticesPerSide, heights, covers } = grid;
  const imgData = ctx.createImageData(textureSize, textureSize);
  const data = imgData.data;

  // Sun direction: North-West (azimuth 315°, 45° altitude)
  const lx = -0.5;
  const lz = -0.5;
  const ly = 0.7071;

  // Precompute shaded relief for the coarse FarGrid
  const shades = new Float32Array(verticesPerSide * verticesPerSide);
  for (let row = 0; row < verticesPerSide; row++) {
    const rowPrev = Math.max(0, row - 1);
    const rowNext = Math.min(verticesPerSide - 1, row + 1);
    const dzStep = (rowNext - rowPrev) * step;

    for (let col = 0; col < verticesPerSide; col++) {
      const colPrev = Math.max(0, col - 1);
      const colNext = Math.min(verticesPerSide - 1, col + 1);
      const dxStep = (colNext - colPrev) * step;

      const dh_dx = (heights[row * verticesPerSide + colNext] - heights[row * verticesPerSide + colPrev]) / dxStep;
      const dh_dz = (heights[rowNext * verticesPerSide + col] - heights[rowPrev * verticesPerSide + col]) / dzStep;

      // Normal vector with vertical exaggeration for clear relief
      const nx = -dh_dx * 2.2;
      const nz = -dh_dz * 2.2;
      const ny = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;

      const dot = (nx * lx + ny * ly + nz * lz) / len;
      // High-contrast shaded relief curve
      shades[row * verticesPerSide + col] = Math.min(1.35, Math.max(0.35, 0.45 + 0.65 * Math.max(0, dot)));
    }
  }

  // Pre-unpack biome cover colors
  const coverRgb = new Map<number, { r: number; g: number; b: number }>();
  for (let i = 0; i < 32; i++) {
    try {
      const cover = coverFromIndex(i);
      const hex = COVER[cover];
      if (hex !== undefined) coverRgb.set(i, hexToRgb(hex));
    } catch {
      // Index past end of cover palette
    }
  }
  const defaultSand = hexToRgb(COVER.sand);

  // Rasterize shaded terrain
  for (let py = 0; py < textureSize; py++) {
    const worldZ = (py / textureSize) * MINIMAP_WORLD_SIZE;
    const gridRow = Math.max(0, Math.min(verticesPerSide - 1, Math.round((worldZ - originZ) / step)));

    for (let px = 0; px < textureSize; px++) {
      const worldX = (px / textureSize) * MINIMAP_WORLD_SIZE;
      const gridCol = Math.max(0, Math.min(verticesPerSide - 1, Math.round((worldX - originX) / step)));

      const gridIndex = gridRow * verticesPerSide + gridCol;
      const shade = shades[gridIndex] ?? 0.8;
      const coverIdx = covers[gridIndex] ?? 0;
      const rgb = coverRgb.get(coverIdx) ?? defaultSand;

      const pIdx = (py * textureSize + px) * 4;
      data[pIdx] = Math.min(255, Math.floor(rgb.r * shade));
      data[pIdx + 1] = Math.min(255, Math.floor(rgb.g * shade));
      data[pIdx + 2] = Math.min(255, Math.floor(rgb.b * shade));
      data[pIdx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Draw Soutpan (salt pan) soft wash
  const panU = SOUTPAN.x / MINIMAP_WORLD_SIZE;
  const panV = SOUTPAN.z / MINIMAP_WORLD_SIZE;
  const panRx = (SOUTPAN.radiusX / MINIMAP_WORLD_SIZE) * textureSize;
  const panRy = (SOUTPAN.radiusZ / MINIMAP_WORLD_SIZE) * textureSize;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(panU * textureSize, panV * textureSize, panRx, panRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(240, 237, 230, 0.42)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(215, 205, 190, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Draw Dam (water reservoir)
  const damU = DAM.water.x / MINIMAP_WORLD_SIZE;
  const damV = DAM.water.z / MINIMAP_WORLD_SIZE;
  const damRx = (DAM.water.radiusX / MINIMAP_WORLD_SIZE) * textureSize;
  const damRy = (DAM.water.radiusZ / MINIMAP_WORLD_SIZE) * textureSize;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(damU * textureSize, damV * textureSize, damRx, damRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#246b8f';
  ctx.fill();
  ctx.strokeStyle = '#47a8d8';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  // Draw Bosveld (forest biome) organic wash
  const bosU = BOSVELD.x / MINIMAP_WORLD_SIZE;
  const bosV = BOSVELD.z / MINIMAP_WORLD_SIZE;
  const bosRx = (BOSVELD.radiusX / MINIMAP_WORLD_SIZE) * textureSize;
  const bosRy = (BOSVELD.radiusZ / MINIMAP_WORLD_SIZE) * textureSize;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(bosU * textureSize, bosV * textureSize, bosRx, bosRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(45, 90, 35, 0.28)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(55, 110, 42, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Draw Dorp yard (town settlement footprint)
  const dorpU = (DORP_YARD.x - DORP_YARD.width / 2) / MINIMAP_WORLD_SIZE;
  const dorpV = (DORP_YARD.z - DORP_YARD.depth / 2) / MINIMAP_WORLD_SIZE;
  const dorpW = (DORP_YARD.width / MINIMAP_WORLD_SIZE) * textureSize;
  const dorpH = (DORP_YARD.depth / MINIMAP_WORLD_SIZE) * textureSize;
  ctx.save();
  ctx.fillStyle = 'rgba(70, 55, 40, 0.45)';
  ctx.fillRect(dorpU * textureSize, dorpV * textureSize, dorpW, dorpH);
  ctx.strokeStyle = 'rgba(255, 210, 61, 0.6)';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(dorpU * textureSize, dorpV * textureSize, dorpW, dorpH);
  ctx.restore();

  // Draw roads and tracks
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const route of ROUTES) {
    if (route.points.length < 2) continue;
    const pts = route.points.map((pt) => ({
      x: (pt.x / MINIMAP_WORLD_SIZE) * textureSize,
      y: (pt.z / MINIMAP_WORLD_SIZE) * textureSize,
    }));

    if (route.kind === 'road') {
      // Road dark casing
      ctx.strokeStyle = 'rgba(45, 32, 18, 0.85)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();

      // Road gravel surface
      ctx.strokeStyle = '#fbf0dc';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    } else {
      // Rough track or trail
      ctx.strokeStyle = 'rgba(212, 175, 125, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // Map outer border line
  ctx.strokeStyle = 'rgba(255, 210, 61, 0.45)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, textureSize - 2, textureSize - 2);
  ctx.restore();

  return canvas;
}

export interface MinimapOptions {
  container: HTMLElement;
  modalContainer: HTMLElement;
  onToggleExpand?: (expanded: boolean) => void;
}

export interface Minimap {
  update(localPose: MinimapLocalPose, remotePlayers: readonly MinimapRemotePlayer[]): void;
  setTerrain(grid: FarGrid): void;
  toggleExpanded(): void;
  setExpanded(expanded: boolean): void;
  isExpanded(): boolean;
  cycleZoom(): void;
  toggleOrientation(): void;
  destroy(): void;
}

export function createMinimap(options: MinimapOptions): Minimap {
  const { container, modalContainer, onToggleExpand } = options;

  let zoomIndex = 1; // Default to 650m
  let headingUp = true;
  let expanded = false;
  let terrainCanvas: HTMLCanvasElement | null = null;

  // Build HUD widget DOM
  container.replaceChildren();

  const wrapper = document.createElement('div');
  wrapper.className = 'minimap-radar-wrapper';

  const radarCanvas = document.createElement('canvas');
  radarCanvas.className = 'minimap-canvas';
  const RADAR_CSS_SIZE = 200;
  radarCanvas.style.width = `${RADAR_CSS_SIZE}px`;
  radarCanvas.style.height = `${RADAR_CSS_SIZE}px`;

  const radarCtx = radarCanvas.getContext('2d');

  const overlay = document.createElement('div');
  overlay.className = 'minimap-overlay';

  const northBadge = document.createElement('div');
  northBadge.className = 'minimap-north';
  northBadge.textContent = 'N';
  northBadge.title = 'Ориентация: клик чтобы переключить (по курсу / на север)';

  const controls = document.createElement('div');
  controls.className = 'minimap-controls';

  const zoomBtn = document.createElement('button');
  zoomBtn.type = 'button';
  zoomBtn.className = 'minimap-btn minimap-btn-zoom';
  zoomBtn.textContent = formatDistance(RADAR_ZOOM_LEVELS[zoomIndex]);
  zoomBtn.title = 'Масштаб миникарты (клик для переключения)';

  const expandBtn = document.createElement('button');
  expandBtn.type = 'button';
  expandBtn.className = 'minimap-btn minimap-btn-expand';
  expandBtn.textContent = '⤢';
  expandBtn.title = 'Развернуть карту на весь экран (M)';

  controls.append(zoomBtn, expandBtn);
  overlay.append(northBadge, controls);
  wrapper.append(radarCanvas, overlay);
  container.append(wrapper);

  // Build Modal Map DOM
  modalContainer.replaceChildren();
  const modalCard = document.createElement('div');
  modalCard.className = 'map-modal-card';

  const modalHeader = document.createElement('div');
  modalHeader.className = 'map-modal-header';
  const modalTitle = document.createElement('div');
  modalTitle.className = 'map-modal-title';
  modalTitle.textContent = 'КАРТА МЕСТНОСТИ · KLIPFONTEIN';
  const modalCloseBtn = document.createElement('button');
  modalCloseBtn.type = 'button';
  modalCloseBtn.className = 'map-modal-close';
  modalCloseBtn.textContent = '✕';
  modalCloseBtn.title = 'Закрыть (M, Esc)';
  modalHeader.append(modalTitle, modalCloseBtn);

  const modalBody = document.createElement('div');
  modalBody.className = 'map-modal-body';

  const modalCanvas = document.createElement('canvas');
  modalCanvas.className = 'map-modal-canvas';
  const MODAL_CSS_SIZE = 540;
  modalCanvas.style.width = `${MODAL_CSS_SIZE}px`;
  modalCanvas.style.height = `${MODAL_CSS_SIZE}px`;
  const modalCtx = modalCanvas.getContext('2d');

  const modalSidebar = document.createElement('div');
  modalSidebar.className = 'map-modal-sidebar';

  const modalPlayersHeader = document.createElement('div');
  modalPlayersHeader.className = 'map-modal-players-title';
  modalPlayersHeader.textContent = 'ИГРОКИ В СЕТИ';
  const modalPlayersList = document.createElement('div');
  modalPlayersList.className = 'map-modal-players-list';
  modalSidebar.append(modalPlayersHeader, modalPlayersList);

  modalBody.append(modalCanvas, modalSidebar);

  const modalFooter = document.createElement('div');
  modalFooter.className = 'map-modal-footer';
  modalFooter.innerHTML = `
    <div class="map-modal-legend">
      <span><span class="legend-dot legend-self"></span> Вы</span>
      <span><span class="legend-dot legend-player"></span> Другие игроки</span>
      <span><span class="legend-line legend-road"></span> Дороги</span>
      <span><span class="legend-line legend-track"></span> Трассы</span>
      <span><span class="legend-dot legend-dam"></span> Водоём</span>
      <span><span class="legend-dot legend-pan"></span> Солончак</span>
    </div>
    <div class="map-modal-hint"><kbd>M</kbd> или <kbd>Esc</kbd> — закрыть</div>
  `;

  modalCard.append(modalHeader, modalBody, modalFooter);
  modalContainer.append(modalCard);
  modalContainer.hidden = true;

  // Interactivity
  const cycleZoom = () => {
    zoomIndex = (zoomIndex + 1) % RADAR_ZOOM_LEVELS.length;
    zoomBtn.textContent = formatDistance(RADAR_ZOOM_LEVELS[zoomIndex]);
  };

  const toggleOrientation = () => {
    headingUp = !headingUp;
    northBadge.classList.toggle('is-fixed-north', !headingUp);
  };

  const setExpanded = (shouldExpand: boolean) => {
    expanded = shouldExpand;
    modalContainer.hidden = !expanded;
    onToggleExpand?.(expanded);
  };

  const toggleExpanded = () => setExpanded(!expanded);

  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cycleZoom();
  });

  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpanded();
  });

  northBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOrientation();
  });

  wrapper.addEventListener('click', () => {
    toggleExpanded();
  });

  modalCloseBtn.addEventListener('click', () => {
    setExpanded(false);
  });

  modalContainer.addEventListener('click', (event) => {
    if (event.target === modalContainer) setExpanded(false);
  });

  // State preservation between frames
  let lastLocalPose: MinimapLocalPose = { x: 1560, z: 2020, forwardX: 0, forwardZ: -1 };
  let lastRemotePlayers: readonly MinimapRemotePlayer[] = [];

  const update = (localPose: MinimapLocalPose, remotePlayers: readonly MinimapRemotePlayer[]) => {
    lastLocalPose = localPose;
    lastRemotePlayers = remotePlayers;

    const dpr = window.devicePixelRatio || 1;
    const radarPx = RADAR_CSS_SIZE * dpr;
    if (radarCanvas.width !== radarPx || radarCanvas.height !== radarPx) {
      radarCanvas.width = radarPx;
      radarCanvas.height = radarPx;
    }

    if (radarCtx) {
      renderRadar(radarCtx, RADAR_CSS_SIZE, dpr, localPose, remotePlayers);
    }

    if (expanded && modalCtx) {
      const modalPx = MODAL_CSS_SIZE * dpr;
      if (modalCanvas.width !== modalPx || modalCanvas.height !== modalPx) {
        modalCanvas.width = modalPx;
        modalCanvas.height = modalPx;
      }
      renderFullMap(modalCtx, MODAL_CSS_SIZE, dpr, localPose, remotePlayers);
      updateModalSidebar(modalPlayersList, localPose, remotePlayers);
    }
  };

  const renderRadar = (
    ctx: CanvasRenderingContext2D,
    size: number,
    dpr: number,
    pose: MinimapLocalPose,
    players: readonly MinimapRemotePlayer[],
  ) => {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 4;
    const viewMeters = RADAR_ZOOM_LEVELS[zoomIndex];
    const heading = carHeadingAngle(pose.forwardX, pose.forwardZ);

    // Update north badge position on the rim
    if (headingUp) {
      const northAngle = -heading - Math.PI / 2;
      const rimRadius = radius - 10;
      const nx = cx + Math.cos(northAngle) * rimRadius;
      const ny = cy + Math.sin(northAngle) * rimRadius;
      northBadge.style.left = `${nx}px`;
      northBadge.style.top = `${ny}px`;
      northBadge.style.transform = 'translate(-50%, -50%)';
    } else {
      northBadge.style.left = `${cx}px`;
      northBadge.style.top = '14px';
      northBadge.style.transform = 'translate(-50%, -50%)';
    }

    // Clip to radar circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // Dark backing
    ctx.fillStyle = '#17130f';
    ctx.fillRect(0, 0, size, size);

    // Draw pre-rendered landscape
    if (terrainCanvas) {
      ctx.save();
      ctx.translate(cx, cy);
      if (headingUp) ctx.rotate(-heading);
      const scale = radius / viewMeters;
      ctx.scale(scale, scale);
      ctx.translate(-pose.x, -pose.z);

      ctx.drawImage(terrainCanvas, 0, 0, MINIMAP_WORLD_SIZE, MINIMAP_WORLD_SIZE);
      ctx.restore();
    } else {
      // Fallback grid before terrain is loaded
      ctx.strokeStyle = 'rgba(255, 210, 61, 0.15)';
      ctx.lineWidth = 1;
      for (let r = 50; r < viewMeters * 2; r += 100) {
        ctx.strokeRect(cx - r / 5, cy - r / 5, (r * 2) / 5, (r * 2) / 5);
      }
    }

    // Concentric range rings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.5, 0, Math.PI * 2);
    ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2);
    ctx.stroke();

    // Subtle crosshairs
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
    ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
    ctx.stroke();

    // Render nearby landmarks on the radar
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const lm of MAP_LANDMARKS) {
      const proj = projectToRadar(pose.x, pose.z, heading, lm.x, lm.z, viewMeters, radius - 14, headingUp);
      if (!proj.isOffscreen) {
        const lx = cx + proj.x;
        const ly = cy + proj.y;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.beginPath();
        ctx.arc(lx, ly, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd23d';
        ctx.beginPath();
        ctx.arc(lx, ly, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillText(lm.name, lx, ly - 8);
      }
    }

    // Render other players
    for (const p of players) {
      const color = markerColorForCar(p.carId);
      const proj = projectToRadar(pose.x, pose.z, heading, p.x, p.z, viewMeters, radius - 8, headingUp);
      const px = cx + proj.x;
      const py = cy + proj.y;

      if (!proj.isOffscreen) {
        // Player is inside radar view
        ctx.save();
        ctx.translate(px, py);

        // Marker dot with dark shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.beginPath();
        ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI * 2);
        ctx.fill();

        // Direction pointer if heading is known
        if (p.heading !== undefined) {
          const arrowAngle = headingUp ? p.heading - heading - Math.PI / 2 : p.heading - Math.PI / 2;
          ctx.rotate(arrowAngle);
          ctx.beginPath();
          ctx.moveTo(6, 0);
          ctx.lineTo(2, -2.5);
          ctx.lineTo(2, 2.5);
          ctx.closePath();
          ctx.fillStyle = color;
          ctx.fill();
        }
        ctx.restore();

        // Player car label
        ctx.fillStyle = '#fff';
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 3;
        ctx.fillText(p.name, px, py + 10);
        ctx.shadowBlur = 0;
      } else {
        // Offscreen player edge blip
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(proj.angleRad);

        // Arrow pointing outward to offscreen player
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(4, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-2, 0);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        // Distance label next to edge blip
        ctx.save();
        ctx.font = '600 8px system-ui, sans-serif';
        ctx.fillStyle = color;
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 2;
        const textDist = formatDistance(proj.distanceMeters);
        const textX = cx + Math.cos(proj.angleRad) * (radius - 18);
        const textY = cy + Math.sin(proj.angleRad) * (radius - 18);
        ctx.fillText(textDist, textX, textY);
        ctx.restore();
      }
    }

    // Local player marker at center (always facing UP in headingUp mode)
    ctx.save();
    ctx.translate(cx, cy);
    if (!headingUp) ctx.rotate(heading);

    // Outer glow / radar wave
    ctx.fillStyle = 'rgba(255, 210, 61, 0.2)';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();

    // Dark outline
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.5, 6.5);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-6.5, 6.5);
    ctx.closePath();
    ctx.fill();

    // Bright yellow/gold chevron
    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // end clip

    // Radar border bezel
    ctx.strokeStyle = 'rgba(255, 210, 61, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  };

  const renderFullMap = (
    ctx: CanvasRenderingContext2D,
    size: number,
    dpr: number,
    pose: MinimapLocalPose,
    players: readonly MinimapRemotePlayer[],
  ) => {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    // Draw background landscape
    if (terrainCanvas) {
      ctx.drawImage(terrainCanvas, 0, 0, size, size);
    } else {
      ctx.fillStyle = '#17130f';
      ctx.fillRect(0, 0, size, size);
    }

    const scale = size / MINIMAP_WORLD_SIZE;

    // Coordinate grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let m = 500; m < MINIMAP_WORLD_SIZE; m += 500) {
      const p = m * scale;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, size);
      ctx.moveTo(0, p); ctx.lineTo(size, p);
      ctx.stroke();
    }

    // Landmark labels
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    for (const lm of MAP_LANDMARKS) {
      const lx = lm.x * scale;
      const ly = lm.z * scale;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.fillText(lm.name, lx, ly - 10);
    }
    ctx.shadowBlur = 0;

    // Draw other players
    for (const p of players) {
      const color = markerColorForCar(p.carId);
      const px = p.x * scale;
      const py = p.z * scale;

      ctx.save();
      ctx.translate(px, py);

      // Marker circle
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
      ctx.fill();

      if (p.heading !== undefined) {
        ctx.rotate(p.heading - Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(7, 0);
        ctx.lineTo(2, -3);
        ctx.lineTo(2, 3);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }
      ctx.restore();

      ctx.font = '700 10px system-ui, sans-serif';
      ctx.fillStyle = color;
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 3;
      ctx.fillText(p.name, px, py + 12);
      ctx.shadowBlur = 0;
    }

    // Local player marker
    const selfX = pose.x * scale;
    const selfY = pose.z * scale;
    const selfHeading = carHeadingAngle(pose.forwardX, pose.forwardZ);

    ctx.save();
    ctx.translate(selfX, selfY);

    // Pulsing ring
    ctx.strokeStyle = 'rgba(255, 210, 61, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();

    ctx.rotate(selfHeading);

    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(7, 7);
    ctx.lineTo(0, 3.5);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffd23d';
    ctx.beginPath();
    ctx.moveTo(0, -7.5);
    ctx.lineTo(5.5, 5.5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5.5, 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.font = '800 11px system-ui, sans-serif';
    ctx.fillStyle = '#ffd23d';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 4;
    ctx.fillText('ВЫ', selfX, selfY + 16);
    ctx.shadowBlur = 0;

    ctx.restore();
  };

  const updateModalSidebar = (
    listEl: HTMLElement,
    pose: MinimapLocalPose,
    players: readonly MinimapRemotePlayer[],
  ) => {
    listEl.replaceChildren();

    // Local player row
    const selfRow = document.createElement('div');
    selfRow.className = 'modal-player-row is-self';
    selfRow.innerHTML = `
      <span class="player-dot" style="background:#ffd23d"></span>
      <span class="player-name">Вы</span>
      <span class="player-coord">${Math.round(pose.x)}, ${Math.round(pose.z)}</span>
    `;
    listEl.append(selfRow);

    if (players.length === 0) {
      const emptyRow = document.createElement('div');
      emptyRow.className = 'modal-player-empty';
      emptyRow.textContent = 'Других игроков пока нет';
      listEl.append(emptyRow);
      return;
    }

    for (const p of players) {
      const dist = Math.hypot(p.x - pose.x, p.z - pose.z);
      const color = markerColorForCar(p.carId);
      const row = document.createElement('div');
      row.className = 'modal-player-row';
      row.innerHTML = `
        <span class="player-dot" style="background:${color}"></span>
        <span class="player-name">${p.name} <small>(${p.carId})</small></span>
        <span class="player-dist">${formatDistance(dist)}</span>
      `;
      listEl.append(row);
    }
  };

  const setTerrain = (grid: FarGrid) => {
    terrainCanvas = bakeTerrainCanvas(grid, 512);
    // Trigger repaint with existing poses
    update(lastLocalPose, lastRemotePlayers);
  };

  const destroy = () => {
    container.replaceChildren();
    modalContainer.replaceChildren();
  };

  return {
    update,
    setTerrain,
    toggleExpanded,
    setExpanded,
    isExpanded: () => expanded,
    cycleZoom,
    toggleOrientation,
    destroy,
  };
}
