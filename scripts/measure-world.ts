// scripts/measure-world.ts
// Measures the world pipeline on the current map: height and surface cost per chunk, server start
// time, memory and the slowest room tick while simulated players drive from the spawn to the inner
// corners of the playable area. Prints a PASS/FAIL line per budget; exit code 1 on any FAIL.
// Run: npx tsx --expose-gc scripts/measure-world.ts [--players 4]
import { createHeightField } from '../src/world/noise';
import { createBiome } from '../src/world/biome';
import { generateChunkHeights } from '../src/world/heightfieldData';
import { generateChunkSurface } from '../src/world/chunkSurface';
import { SPAWN, WORLD_CHUNKS, WORLD_SIZE } from '../src/world/worldDef';
import { generateFarGrid } from '../src/world/farGrid';
import { BORDER } from '../src/world/mapLayout';
import type { ChunkCoord } from '../src/world/chunk';
import { ArenaSim, SIM_STEP_SECONDS } from '../server/arenaSim';
import { TICK_HZ } from '../shared/protocol';
import { CAR_IDS } from '../src/vehicle/cars';

const SEED = 1;
const MEASURED_CHUNKS = 200;
const WARM_UP_CHUNKS = 20;
const DRIVE_SPEED = 53; // m/s, about 190 km/h: the fastest a car gets on this map
// The inner corners of the playable area: just inside the widest reach of the border apron.
const PLAYABLE_MIN = BORDER.apronStart + BORDER.apronWander;
const PLAYABLE_MAX = WORLD_SIZE - PLAYABLE_MIN;
const CORNER_INSET = 24;
const FAR_GRID = { step: 8, margin: 128 };
const TELEPORT_LIFT = 1;
const STEPS_PER_TICK = Math.max(1, Math.round(1 / TICK_HZ / SIM_STEP_SECONDS));
const MEGABYTE = 1024 * 1024;

const BUDGET = {
  heightP95Ms: 5,
  surfaceP95Ms: 8,
  farGridMs: 1000,
  startMs: 1000,
  slowestTickMs: 25,
  rssMegabytes: 200,
};

function playerCountFromArguments(): number {
  const flag = process.argv.indexOf('--players');
  if (flag === -1) return 4;
  const count = Number(process.argv[flag + 1]);
  if (!Number.isInteger(count) || count < 1) throw new Error(`measure-world: --players needs a whole number ≥ 1, got ${process.argv[flag + 1]}`);
  return count;
}

function percentile(sorted: readonly number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

function timePerChunk(chunks: readonly ChunkCoord[], work: (chunk: ChunkCoord) => void): { p50: number; p95: number } {
  for (const chunk of chunks.slice(0, WARM_UP_CHUNKS)) work(chunk);
  const times = chunks.map((chunk) => {
    const start = performance.now();
    work(chunk);
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return { p50: percentile(times, 0.5), p95: percentile(times, 0.95) };
}

function memory(): { rss: number; heapUsed: number; external: number } {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  const usage = process.memoryUsage();
  return { rss: usage.rss / MEGABYTE, heapUsed: usage.heapUsed / MEGABYTE, external: usage.external / MEGABYTE };
}

const formatMemory = (label: string, sample: ReturnType<typeof memory>): string =>
  `${label}: RSS ${sample.rss.toFixed(0)} MB, heap ${sample.heapUsed.toFixed(0)} MB, external ${sample.external.toFixed(0)} MB`;

const players = playerCountFromArguments();
const height = createHeightField(SEED);
const biome = createBiome(SEED);

// Chunks spread evenly over the map and one chunk past its edge, so the border is measured too.
const side = Math.ceil(Math.sqrt(MEASURED_CHUNKS));
const spacing = (WORLD_CHUNKS + 2) / side;
const measured: ChunkCoord[] = [];
for (let index = 0; index < MEASURED_CHUNKS; index++) {
  measured.push({ cx: Math.floor((index % side) * spacing) - 1, cz: Math.floor(Math.floor(index / side) * spacing) - 1 });
}
const heightCost = timePerChunk(measured, (chunk) => generateChunkHeights(height, chunk));
const surfaceCost = timePerChunk(measured, (chunk) => generateChunkSurface(height, biome, chunk));
console.log(`height per chunk: p50 ${heightCost.p50.toFixed(2)} ms, p95 ${heightCost.p95.toFixed(2)} ms (${MEASURED_CHUNKS} chunks)`);
console.log(`surface per chunk: p50 ${surfaceCost.p50.toFixed(2)} ms, p95 ${surfaceCost.p95.toFixed(2)} ms`);
const farStart = performance.now();
const farGrid = generateFarGrid(height, biome, FAR_GRID);
const farGridMs = performance.now() - farStart;
console.log(`far grid: ${farGrid.verticesPerSide}² vertices (step ${FAR_GRID.step} m, margin ${FAR_GRID.margin} m) in ${farGridMs.toFixed(0)} ms`);

const beforeStart = memory();
const startTime = performance.now();
const sim = await ArenaSim.create(SEED);
const startMs = performance.now() - startTime;
const afterStart = memory();
console.log(`\nserver start: ${startMs.toFixed(0)} ms, ${sim.builtChunkCount()} chunks built of ${WORLD_CHUNKS * WORLD_CHUNKS}`);
console.log(formatMemory('before create', beforeStart));
console.log(formatMemory('after create', afterStart));

const corners = [
  { x: PLAYABLE_MIN + CORNER_INSET, z: PLAYABLE_MIN + CORNER_INSET },
  { x: PLAYABLE_MAX - CORNER_INSET, z: PLAYABLE_MIN + CORNER_INSET },
  { x: PLAYABLE_MIN + CORNER_INSET, z: PLAYABLE_MAX - CORNER_INSET },
  { x: PLAYABLE_MAX - CORNER_INSET, z: PLAYABLE_MAX - CORNER_INSET },
];
const routes = Array.from({ length: players }, (_unused, index) => {
  const target = corners[index % corners.length];
  const length = Math.hypot(target.x - SPAWN.x, target.z - SPAWN.z);
  return { id: `driver-${index}`, target, length, directionX: (target.x - SPAWN.x) / length, directionZ: (target.z - SPAWN.z) / length };
});
for (const [index, route] of routes.entries()) sim.addPlayer(route.id, CAR_IDS[index % CAR_IDS.length], sim.nextFreeSpawnSlot());

let travelled = 0;
let slowestTick = 0;
let ticks = 0;
const longestRoute = Math.max(...routes.map((route) => route.length));
while (travelled < longestRoute) {
  const tickStart = performance.now();
  for (let step = 0; step < STEPS_PER_TICK; step++) {
    travelled += DRIVE_SPEED * SIM_STEP_SECONDS;
    for (const route of routes) {
      const along = Math.min(travelled, route.length);
      const moving = travelled < route.length;
      sim.teleportPlayer(route.id, SPAWN.x + route.directionX * along, SPAWN.z + route.directionZ * along, TELEPORT_LIFT, {
        vx: moving ? route.directionX * DRIVE_SPEED : 0,
        vz: moving ? route.directionZ * DRIVE_SPEED : 0,
      });
    }
    sim.step();
  }
  slowestTick = Math.max(slowestTick, performance.now() - tickStart);
  ticks++;
}
const afterDrive = memory();
console.log(`\n${players} player(s) drove ${longestRoute.toFixed(0)} m at ${DRIVE_SPEED} m/s in ${ticks} ticks`);
console.log(`chunks built: ${sim.builtChunkCount()} of ${WORLD_CHUNKS * WORLD_CHUNKS}; slowest tick ${slowestTick.toFixed(1)} ms`);
console.log(formatMemory('after the drive', afterDrive));

console.log('\nBudgets:');
let failures = 0;
const verdict = (label: string, pass: boolean, value: string): void => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${value}`);
};
verdict(`height p95 ≤ ${BUDGET.heightP95Ms} ms per chunk`, heightCost.p95 <= BUDGET.heightP95Ms, `${heightCost.p95.toFixed(2)} ms`);
verdict(`surface p95 ≤ ${BUDGET.surfaceP95Ms} ms per chunk`, surfaceCost.p95 <= BUDGET.surfaceP95Ms, `${surfaceCost.p95.toFixed(2)} ms`);
verdict(`far grid ≤ ${BUDGET.farGridMs} ms`, farGridMs <= BUDGET.farGridMs, `${farGridMs.toFixed(0)} ms`);
verdict(`server start < ${BUDGET.startMs} ms`, startMs < BUDGET.startMs, `${startMs.toFixed(0)} ms`);
verdict(`slowest tick < ${BUDGET.slowestTickMs} ms`, slowestTick < BUDGET.slowestTickMs, `${slowestTick.toFixed(1)} ms`);
verdict(`RSS after the drive < ${BUDGET.rssMegabytes} MB`, afterDrive.rss < BUDGET.rssMegabytes, `${afterDrive.rss.toFixed(0)} MB`);
if (typeof globalThis.gc !== 'function') console.log('note: run with --expose-gc for steadier memory numbers');
console.log(failures === 0 ? '\nAll budgets PASS.' : `\n${failures} budget(s) FAIL.`);
process.exitCode = failures === 0 ? 0 : 1;
