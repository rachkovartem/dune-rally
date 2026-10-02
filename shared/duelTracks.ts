// shared/duelTracks.ts
// Authored tracks and checkpoints for head-to-head multiplayer duels.

export type DuelTrackId = 'die_myl' | 'dune_raid' | 'ooslus';

export interface DuelGridSlot {
  x: number;
  z: number;
  yaw: number;
}

export interface DuelCheckpoint {
  x: number;
  z: number;
  radius: number;
  label?: string;
}

export interface DuelTrackDef {
  id: DuelTrackId;
  name: string;
  subtitle: string;
  badge: string;
  distanceMeters: number;
  surface: 'salt' | 'sand' | 'tarmac';
  startSlots: readonly [DuelGridSlot, DuelGridSlot];
  checkpoints: readonly DuelCheckpoint[];
  finish: DuelCheckpoint;
}

export const DUEL_TRACKS: readonly DuelTrackDef[] = [
  {
    id: 'die_myl',
    name: 'Драг на солончаке',
    subtitle: '1200 м по ровной глади Soutpan · чистая скорость',
    badge: '⚡ ДРАГ',
    distanceMeters: 1200,
    surface: 'salt',
    startSlots: [
      { x: 1750, z: 2554, yaw: -Math.PI / 2 },
      { x: 1750, z: 2566, yaw: -Math.PI / 2 },
    ],
    checkpoints: [
      { x: 1350, z: 2560, radius: 28, label: '400 м' },
      { x: 950, z: 2560, radius: 28, label: '800 м' },
    ],
    finish: { x: 550, z: 2560, radius: 32, label: 'ФИНИШ (1200 м)' },
  },
  {
    id: 'dune_raid',
    name: 'Штурм барханов',
    subtitle: '650 м по гребням дюн Wit Duine к Big Daddy',
    badge: '🏜️ РЕЙД',
    distanceMeters: 650,
    surface: 'sand',
    startSlots: [
      { x: 2355, z: 1800, yaw: 2.43 },
      { x: 2365, z: 1808, yaw: 2.43 },
    ],
    checkpoints: [
      { x: 2480, z: 1660, radius: 30, label: 'Гребень Wit Duine' },
      { x: 2610, z: 1520, radius: 30, label: 'Склон бархана' },
    ],
    finish: { x: 2750, z: 1370, radius: 35, label: 'Подножие Big Daddy' },
  },
  {
    id: 'ooslus',
    name: 'Ралли Ooslus',
    subtitle: '2.4 км дорог вокруг холма Tafelkop к ферме',
    badge: '🏎️ РАЛЛИ',
    distanceMeters: 2400,
    surface: 'tarmac',
    startSlots: [
      { x: 1580, z: 1025, yaw: 2.08 },
      { x: 1585, z: 1035, yaw: 2.08 },
    ],
    checkpoints: [
      { x: 1950, z: 820, radius: 26, label: 'Северная дуга' },
      { x: 2220, z: 660, radius: 26, label: 'Подножие Tafelkop' },
      { x: 2060, z: 1100, radius: 26, label: 'Спуск в каньон' },
      { x: 2060, z: 1600, radius: 26, label: 'Восточная прямая' },
      { x: 1880, z: 1950, radius: 26, label: 'Поворот к ферме' },
    ],
    finish: { x: 1580, z: 2220, radius: 32, label: 'Ворота фермы (ФИНИШ)' },
  },
];

export function duelTrackById(id: string): DuelTrackDef | undefined {
  return DUEL_TRACKS.find((track) => track.id === id);
}

export function isDuelTrackId(value: unknown): value is DuelTrackId {
  return typeof value === 'string' && DUEL_TRACKS.some((t) => t.id === value);
}

/** Check whether a point (car position) is inside the checkpoint cylinder. */
export function isPointInsideCheckpoint(point: { x: number; z: number }, cp: DuelCheckpoint): boolean {
  const dx = point.x - cp.x;
  const dz = point.z - cp.z;
  return dx * dx + dz * dz <= cp.radius * cp.radius;
}
