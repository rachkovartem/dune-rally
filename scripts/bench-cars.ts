// scripts/bench-cars.ts
// Prints the car numbers (spec C2.6–C2.12, plan v3 S0-4 real gravity, Elantra E2, plan v3 S2-3
// ground: salt, gravel, sand, Die Myl) with a PASS/FAIL line per target; exit code 1 on any FAIL.
// Run: npx tsx scripts/bench-cars.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_IDS } from '../src/vehicle/cars';
import { restingSuspensionLength, vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import { FULL_GRIP, groundGripFor } from '../shared/terrainGrip';
import {
  chassisBottomOf, createBenchCar, runBraking, runCrest, runDropSettle, runGroundLine, runHillClimb, runRidge, runRollover,
  runStraightLine, runTurn, speedAt, stepBenchCar,
} from '../shared/carBench';
import type { CarId } from '../src/vehicle/cars';

const KMH = 3.6;
const DEGREES = 180 / Math.PI;
const kmh = (speed: number): string => (speed * KMH).toFixed(1);
const secondsOrDash = (seconds: number | null): string => (seconds === null ? '—' : seconds.toFixed(2));

await RAPIER.init();

const surfaces = ['road', 'sand'] as const;
const rows: string[][] = [[
  'car', 'ground', 'grip', '0–60 s', '0–100 s', 'v@5s', 'v@10s', 'v@20s', 'top km/h',
  '100–0 m', 'W+A 5s °', 'lock@60 5s °', 'roll@60 °', 'lock@top 3s °', 'roll@top °', 'flip',
]];
const speedAt5: Record<string, number> = {};
const results: Record<string, { timeTo100: number | null; topSpeed: number; rollAt60: number; headingAt60: number; flipped: boolean }> = {};

for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  for (const surface of surfaces) {
    const ground = groundGripFor(surface, config);
    const straight = runStraightLine(config, ground, 70);
    speedAt5[`${carId}:${surface}`] = speedAt(straight, 5);
    const braking = runBraking(config, ground, 100 / KMH);
    const fromStandstill = runTurn(config, { entrySpeed: 0, seconds: 5, steer: -1, ground });
    const at60 = runTurn(config, { entrySpeed: 60 / KMH, seconds: 5, steer: -1, ground });
    const atTop = runTurn(config, { entrySpeed: straight.topSpeed * 0.97, seconds: 3, steer: -1, ground });
    results[`${carId}:${surface}`] = {
      timeTo100: straight.timeTo100,
      topSpeed: straight.topSpeed,
      rollAt60: at60.maxRoll,
      headingAt60: at60.headingChange,
      flipped: at60.flipped || atTop.flipped,
    };
    rows.push([
      carId, surface, ground.grip.toFixed(2),
      secondsOrDash(straight.timeTo60), secondsOrDash(straight.timeTo100),
      kmh(speedAt(straight, 5)), kmh(speedAt(straight, 10)), kmh(speedAt(straight, 20)), kmh(straight.topSpeed),
      braking.distance.toFixed(1),
      (fromStandstill.headingChange * DEGREES).toFixed(0),
      (at60.headingChange * DEGREES).toFixed(0), (at60.maxRoll * DEGREES).toFixed(1),
      (atTop.headingChange * DEGREES).toFixed(0), (atTop.maxRoll * DEGREES).toFixed(1),
      String(at60.flipped || atTop.flipped || fromStandstill.flipped),
    ]);
  }
}

const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
for (const row of rows) console.log(row.map((cell, column) => cell.padStart(widths[column])).join(' | '));

const gap = (surface: string): number => 1 - speedAt5[`pajero:${surface}`] / speedAt5[`forester:${surface}`];
console.log(`\nC2.12 Pajero speed gap at 5 s: road ${(gap('road') * 100).toFixed(1)}%, sand ${(gap('sand') * 100).toFixed(1)}%`);

console.log('\nGear / rpm trace, full throttle on road (every second):');
for (const carId of CAR_IDS) {
  const straight = runStraightLine(vehicleConfigFor(carId), FULL_GRIP, 12);
  const trace = straight.samples
    .filter((_, index) => (index + 1) % 60 === 0)
    .map((sample) => `${sample.time.toFixed(0)}s ${kmh(sample.speed)} km/h g${sample.gear} ${sample.rpm.toFixed(0)}rpm`);
  console.log(`${carId}: ${trace.join(' · ')}`);
}

console.log('\nSteering direction: D (steer +1) for 3 s from standstill:');
for (const carId of CAR_IDS) {
  const right = runTurn(vehicleConfigFor(carId), { entrySpeed: 0, seconds: 3, steer: 1, ground: FULL_GRIP });
  console.log(`${carId}: heading change ${(right.headingChange * DEGREES).toFixed(0)}° (negative = turned right)`);
}

console.log('\nRollover: on the roof at 10 m/s heading 90°, full throttle 3 s, then R and W 3 s:');
for (const carId of CAR_IDS) {
  const rollover = runRollover(vehicleConfigFor(carId), Math.PI / 2, 10);
  console.log(
    `${carId}: wheels in contact on roof max ${rollover.maxWheelsInContactUpsideDown}, `
    + `speed ${kmh(rollover.speedAfterLanding)} → ${kmh(rollover.speedAfterThreeSeconds)} km/h, `
    + `heading ${(rollover.headingBeforeReset * DEGREES).toFixed(0)}° → ${(rollover.headingAfterReset * DEGREES).toFixed(0)}° after R, `
    + `W moved ${rollover.progressAlongNose.toFixed(1)} m along the nose`,
  );
}

console.log('\nReverse: hold S for 8 s from a standstill:');
const reverseSpeeds: Partial<Record<CarId, number>> = {};
for (const carId of CAR_IDS) {
  const car = createBenchCar(vehicleConfigFor(carId));
  let slowest = 0;
  while (car.time < 8) {
    stepBenchCar(car, { throttle: 0, brake: 1, steer: 0 }, FULL_GRIP);
    slowest = Math.min(slowest, car.vehicle.forwardSpeed());
  }
  reverseSpeeds[carId] = -slowest;
  console.log(`${carId}: reverse speed ${kmh(-slowest)} km/h, gear ${car.vehicle.drivetrain().gear}`);
}

console.log('\nSuspension, crest, hills and drop (real gravity):');
const CREST_RADIUS = 100;
const CREST_SPEED = 100 / KMH;
const ROCK_FACE_SLOPE = 0.8;
const SLIP_FACE_SLOPE = 0.58;
const DROP_HEIGHT = 0.3;
interface GroundChecks {
  resting: number;
  measuredResting: number;
  droop: number;
  crest: ReturnType<typeof runCrest>;
  rockClimb: ReturnType<typeof runHillClimb>;
  sandClimb: ReturnType<typeof runHillClimb>;
  drop: ReturnType<typeof runDropSettle>;
}
const checks: Partial<Record<CarId, GroundChecks>> = {};
for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  const resting = restingSuspensionLength(config.wheel);
  const settled = createBenchCar(config);
  let measuredResting = 0;
  for (let wheelIndex = 0; wheelIndex < config.wheel.positions.length; wheelIndex++) {
    measuredResting += (settled.vehicle.controller.wheelSuspensionLength(wheelIndex) ?? Number.NaN) / config.wheel.positions.length;
  }
  const result: GroundChecks = {
    resting,
    measuredResting,
    droop: config.wheel.suspensionRestLength - resting,
    crest: runCrest(config, CREST_RADIUS, CREST_SPEED),
    rockClimb: runHillClimb(config, ROCK_FACE_SLOPE, groundGripFor('rock', config)),
    sandClimb: runHillClimb(config, SLIP_FACE_SLOPE, groundGripFor('sand', config)),
    drop: runDropSettle(config, DROP_HEIGHT),
  };
  checks[carId] = result;
  console.log(
    `${carId}: resting ${resting.toFixed(3)} m (measured ${measuredResting.toFixed(3)}), droop ${result.droop.toFixed(3)} m · `
    + `crest R${CREST_RADIUS} @${kmh(CREST_SPEED)}: min wheels ${result.crest.minWheelsInContact}, air ${result.crest.airSeconds.toFixed(2)} s, flip ${result.crest.flipped} · `
    + `rock ${ROCK_FACE_SLOPE}: top ${result.rockClimb.reachedTop} (best ${result.rockClimb.bestProgress.toFixed(1)} m) · `
    + `sand ${SLIP_FACE_SLOPE}: top ${result.sandClimb.reachedTop} (best ${result.sandClimb.bestProgress.toFixed(1)} m) · `
    + `drop ${DROP_HEIGHT} m: settle ${result.drop.settleSeconds.toFixed(2)} s, bounce ${(result.drop.maxBounce * 100).toFixed(1)} cm`,
  );
}

console.log('\nTargets (plan v3 S0-4):');
let failures = 0;
const verdict = (label: string, pass: boolean, value: string): void => {
  if (!pass) failures++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${value}`);
};
const within = (value: number | null, low: number, high: number): boolean => value !== null && value >= low && value <= high;
const DEGREES_LIMIT: Record<CarId, number> = { forester: 4, pajero: 6, elantra: 3.5 };
// Elantra AD 2.0 6AT: about 9–10 s and 190–205 km/h (approximate, not one source). Its 200 km/h
// governor fades the force over a band, so it settles a little above 200.
// Pajero Sport gen 3 facelift 2.4 8AT: about 11–12.5 s and 180–190 km/h (approximate).
const ZERO_TO_100: Record<CarId, [number, number]> = { forester: [8.5, 9.5], pajero: [11.0, 12.5], elantra: [9.0, 10.0] };
const TOP_SPEED: Record<CarId, [number, number]> = { forester: [185, 200], pajero: [180, 190], elantra: [190, 205] };
// The Elantra value is provisional: the visual fit is set again when its body model lands.
const RESTING_TARGET: Record<CarId, number> = { forester: 0.481, pajero: 0.353, elantra: 0.293 };
for (const carId of CAR_IDS) {
  const road = results[`${carId}:road`];
  const sand = results[`${carId}:sand`];
  const ground = checks[carId];
  const reverse = reverseSpeeds[carId];
  if (!road || !sand || !ground || reverse === undefined) throw new Error(`bench: no results for ${carId}`);
  const [fastest, slowest] = ZERO_TO_100[carId];
  verdict(`${carId} 0–100 road ${fastest}–${slowest} s`, within(road.timeTo100, fastest, slowest), secondsOrDash(road.timeTo100));
  const [lowTop, highTop] = TOP_SPEED[carId];
  verdict(`${carId} top speed ${lowTop}–${highTop} km/h`, within(road.topSpeed * KMH, lowTop, highTop), kmh(road.topSpeed));
  verdict(`${carId} slower on sand`, sand.topSpeed < road.topSpeed && (sand.timeTo100 ?? Infinity) > (road.timeTo100 ?? Infinity),
    `0–100 ${secondsOrDash(road.timeTo100)} → ${secondsOrDash(sand.timeTo100)} s, top ${kmh(road.topSpeed)} → ${kmh(sand.topSpeed)}`);
  verdict(`${carId} resting length ${RESTING_TARGET[carId]} ± 0.01 m`, Math.abs(ground.resting - RESTING_TARGET[carId]) <= 0.01, ground.resting.toFixed(3));
  verdict(`${carId} droop travel ≥ 0.10 m`, ground.droop >= 0.1, ground.droop.toFixed(3));
  verdict(`${carId} roll at 60 full lock ≤ ${DEGREES_LIMIT[carId]}°`, road.rollAt60 * DEGREES <= DEGREES_LIMIT[carId], (road.rollAt60 * DEGREES).toFixed(1));
  verdict(`${carId} no flip at 60 and 0.97 × top (road, sand)`, !road.flipped && !sand.flipped, String(road.flipped || sand.flipped));
  verdict(`${carId} crest R${CREST_RADIUS} @100: ≥ 2 wheels down`, ground.crest.minWheelsInContact >= 2 && !ground.crest.flipped, String(ground.crest.minWheelsInContact));
  verdict(`${carId} cannot climb rock ${ROCK_FACE_SLOPE}`, !ground.rockClimb.reachedTop, `best ${ground.rockClimb.bestProgress.toFixed(1)} m`);
  verdict(`${carId} drop ${DROP_HEIGHT} m settles < 1.5 s, bounce < 3 cm`, ground.drop.settleSeconds < 1.5 && ground.drop.maxBounce < 0.03,
    `${ground.drop.settleSeconds.toFixed(2)} s, ${(ground.drop.maxBounce * 100).toFixed(1)} cm`);
  verdict(`${carId} reverse about 30 km/h`, within(reverse * KMH, 27, 33), kmh(reverse));
}
const forester = checks.forester;
const pajero = checks.pajero;
const foresterRoad = results['forester:road'];
const pajeroRoad = results['pajero:road'];
if (!forester || !pajero || !foresterRoad || !pajeroRoad) throw new Error('bench: missing a car');
verdict('pajero rolls more than forester at 60', pajeroRoad.rollAt60 > foresterRoad.rollAt60,
  `${(foresterRoad.rollAt60 * DEGREES).toFixed(1)}° vs ${(pajeroRoad.rollAt60 * DEGREES).toFixed(1)}°`);
verdict(`forester cannot climb the sand slip face ${SLIP_FACE_SLOPE}`, !forester.sandClimb.reachedTop, `best ${forester.sandClimb.bestProgress.toFixed(1)} m`);
verdict(`pajero climbs the sand slip face ${SLIP_FACE_SLOPE}`, pajero.sandClimb.reachedTop, `best ${pajero.sandClimb.bestProgress.toFixed(1)} m`);
verdict('C2.12 pajero gap smaller on sand than on road', gap('sand') < gap('road'),
  `road ${(gap('road') * 100).toFixed(1)}%, sand ${(gap('sand') * 100).toFixed(1)}%`);

console.log('\nFWD and underbody (Elantra addendum E2):');
const ROAD_SLOPE = 0.35;
const ROCK_SLOPE = 0.4;
const DUNE_SAND_SLOPE = 0.25;
// With the belly at the sill (0.2 m), 9° ramps make the Elantra scrape while its wheels still pull
// it over; from 13° it hangs (14° keeps a margin). The Forester's belly never touches either.
const SCRAPE_RIDGE_ANGLE = 9;
const RIDGE_ANGLE = 14;
const RIDGE_SPEED = 10 / KMH;
// The model's visible sill (0.202 m), so the body does not sink into the ground before it scrapes.
const UNDERBODY_TARGET = 0.2;
interface TerrainChecks {
  settledBottom: number;
  roadSlope: ReturnType<typeof runHillClimb>;
  rockSlope: ReturnType<typeof runHillClimb>;
  duneSandSlope: ReturnType<typeof runHillClimb>;
  scrapeRidge: ReturnType<typeof runRidge>;
  ridge: ReturnType<typeof runRidge>;
}
const terrain: Partial<Record<CarId, TerrainChecks>> = {};
for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  const settled = createBenchCar(config);
  const result: TerrainChecks = {
    settledBottom: chassisBottomOf(settled.vehicle, config),
    roadSlope: runHillClimb(config, ROAD_SLOPE, groundGripFor('road', config)),
    rockSlope: runHillClimb(config, ROCK_SLOPE, groundGripFor('rock', config)),
    duneSandSlope: runHillClimb(config, DUNE_SAND_SLOPE, groundGripFor('sand', config)),
    scrapeRidge: runRidge(config, SCRAPE_RIDGE_ANGLE, RIDGE_SPEED),
    ridge: runRidge(config, RIDGE_ANGLE, RIDGE_SPEED),
  };
  terrain[carId] = result;
  const drop = checks[carId]?.drop;
  console.log(
    `${carId}: chassis bottom at rest ${result.settledBottom.toFixed(3)} m, lowest in drop ${drop ? drop.minChassisClearance.toFixed(3) : '—'} m · `
    + `road ${ROAD_SLOPE}: top ${result.roadSlope.reachedTop} (best ${result.roadSlope.bestProgress.toFixed(1)} m) · `
    + `rock ${ROCK_SLOPE}: top ${result.rockSlope.reachedTop} (best ${result.rockSlope.bestProgress.toFixed(1)} m) · `
    + `sand ${DUNE_SAND_SLOPE}: top ${result.duneSandSlope.reachedTop} (best ${result.duneSandSlope.bestProgress.toFixed(1)} m) · `
    + `ridge ${SCRAPE_RIDGE_ANGLE}° @${kmh(RIDGE_SPEED)}: crossed ${result.scrapeRidge.crossed}, belly ${result.scrapeRidge.bellyContactSeconds.toFixed(2)} s · `
    + `ridge ${RIDGE_ANGLE}° @${kmh(RIDGE_SPEED)}: crossed ${result.ridge.crossed}, stuck ${result.ridge.stuckSeconds.toFixed(1)} s, belly ${result.ridge.bellyContactSeconds.toFixed(2)} s`,
  );
}
const elantra = checks.elantra;
const elantraTerrain = terrain.elantra;
const foresterTerrain = terrain.forester;
const elantraRoad = results['elantra:road'];
if (!elantra || !elantraTerrain || !foresterTerrain || !elantraRoad) throw new Error('bench: missing the Elantra or the Forester');
const elantraGap = (surface: string): number => 1 - speedAt5[`elantra:${surface}`] / speedAt5[`forester:${surface}`];
verdict(`elantra chassis bottom at rest ${UNDERBODY_TARGET} ± 0.02 m`, Math.abs(elantraTerrain.settledBottom - UNDERBODY_TARGET) <= 0.02,
  elantraTerrain.settledBottom.toFixed(3));
verdict(`elantra chassis does not touch the ground in the ${DROP_HEIGHT} m drop`, elantra.drop.minChassisClearance > 0,
  `${elantra.drop.minChassisClearance.toFixed(3)} m`);
verdict('elantra rolls less than forester at 60', elantraRoad.rollAt60 < foresterRoad.rollAt60,
  `${(elantraRoad.rollAt60 * DEGREES).toFixed(1)}° vs ${(foresterRoad.rollAt60 * DEGREES).toFixed(1)}°`);
verdict('elantra full lock at 60 turns at least as far as forester', elantraRoad.headingAt60 >= foresterRoad.headingAt60,
  `${(elantraRoad.headingAt60 * DEGREES).toFixed(0)}° vs ${(foresterRoad.headingAt60 * DEGREES).toFixed(0)}°`);
verdict(`elantra climbs the road slope ${ROAD_SLOPE}`, elantraTerrain.roadSlope.reachedTop, `best ${elantraTerrain.roadSlope.bestProgress.toFixed(1)} m`);
verdict(`elantra cannot climb the rock slope ${ROCK_SLOPE}, forester can`,
  !elantraTerrain.rockSlope.reachedTop && foresterTerrain.rockSlope.reachedTop,
  `best ${elantraTerrain.rockSlope.bestProgress.toFixed(1)} m vs ${foresterTerrain.rockSlope.bestProgress.toFixed(1)} m`);
verdict(`elantra cannot climb the sand slope ${DUNE_SAND_SLOPE}, forester can`,
  !elantraTerrain.duneSandSlope.reachedTop && foresterTerrain.duneSandSlope.reachedTop,
  `best ${elantraTerrain.duneSandSlope.bestProgress.toFixed(1)} m vs ${foresterTerrain.duneSandSlope.bestProgress.toFixed(1)} m`);
verdict(`elantra scrapes its belly on the ${SCRAPE_RIDGE_ANGLE}° ridge, forester does not`,
  elantraTerrain.scrapeRidge.bellyContactSeconds > 0 && foresterTerrain.scrapeRidge.bellyContactSeconds === 0,
  `${elantraTerrain.scrapeRidge.bellyContactSeconds.toFixed(2)} s vs ${foresterTerrain.scrapeRidge.bellyContactSeconds.toFixed(2)} s`);
verdict(`elantra hangs on the ${RIDGE_ANGLE}° ridge at ${kmh(RIDGE_SPEED)} km/h, forester crosses`,
  !elantraTerrain.ridge.crossed && foresterTerrain.ridge.crossed,
  `elantra stuck ${elantraTerrain.ridge.stuckSeconds.toFixed(1)} s, forester crossed ${foresterTerrain.ridge.crossed}`);
verdict('elantra gap to forester at 5 s bigger on sand than on road', elantraGap('sand') > elantraGap('road'),
  `road ${(elantraGap('road') * 100).toFixed(1)}%, sand ${(elantraGap('sand') * 100).toFixed(1)}%`);
console.log('\nGround (plan v3 S2-3, AC7): speed after 3 s of full throttle from a stop:');
// The design's riverbed sand and dune sand are the same cover, so they give the same numbers.
const GROUND_SURFACES = ['salt', 'gravel', 'sand'] as const;
const LAUNCH_SECONDS = 3;
const launch: Partial<Record<CarId, Record<(typeof GROUND_SURFACES)[number], number>>> = {};
for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  const speeds = { salt: 0, gravel: 0, sand: 0 };
  for (const surface of GROUND_SURFACES) speeds[surface] = speedAt(runStraightLine(config, groundGripFor(surface, config), LAUNCH_SECONDS), LAUNCH_SECONDS);
  launch[carId] = speeds;
  const ground = (surface: (typeof GROUND_SURFACES)[number]): string => {
    const grip = groundGripFor(surface, config);
    return `${surface} ${kmh(speeds[surface])} km/h (grip ${grip.grip.toFixed(2)}, RR ${grip.rollingResistance.toFixed(3)})`;
  };
  console.log(`${carId}: ${GROUND_SURFACES.map(ground).join(' · ')}`);
}
for (const carId of CAR_IDS) {
  const speeds = launch[carId];
  if (!speeds) throw new Error(`bench: no launch numbers for ${carId}`);
  verdict(`${carId} fastest on salt, slowest on sand after ${LAUNCH_SECONDS} s`, speeds.salt > speeds.gravel && speeds.gravel > speeds.sand,
    `salt ${kmh(speeds.salt)}, gravel ${kmh(speeds.gravel)}, sand ${kmh(speeds.sand)} km/h`);
}
const pajeroLaunch = launch.pajero;
const foresterLaunch = launch.forester;
if (!pajeroLaunch || !foresterLaunch) throw new Error('bench: missing launch numbers');
verdict('pajero faster than forester on dune sand after 3 s', pajeroLaunch.sand > foresterLaunch.sand,
  `${kmh(pajeroLaunch.sand)} vs ${kmh(foresterLaunch.sand)} km/h`);

console.log('\nDie Myl (AC1): full throttle from a stop, 900 m of gravel then 1350 m of salt:');
const MYL_GRAVEL = 900;
const MYL_SALT = 1350;
const MYL_MIN_SECONDS = 45;
const MYL_MIN_SPEED = 180;
for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  const run = runGroundLine(config, [
    { length: MYL_GRAVEL, ground: groundGripFor('gravel', config) },
    { length: MYL_SALT, ground: groundGripFor('salt', config) },
  ], 180);
  console.log(`${carId}: ${run.seconds === null ? 'did not finish' : `${run.seconds.toFixed(1)} s`}, `
    + `${kmh(run.speedAtEndOf[0])} km/h at the pan edge, ${kmh(run.speedAtEndOf[1])} km/h at the west shore, top ${kmh(run.topSpeed)}`);
  if (carId === 'forester') {
    verdict(`forester Die Myl takes ≥ ${MYL_MIN_SECONDS} s and reaches ≥ ${MYL_MIN_SPEED} km/h`,
      run.seconds !== null && run.seconds >= MYL_MIN_SECONDS && run.topSpeed * KMH >= MYL_MIN_SPEED,
      `${run.seconds === null ? '—' : run.seconds.toFixed(1)} s, ${kmh(run.topSpeed)} km/h`);
  }
}
console.log(failures === 0 ? '\nAll targets PASS.' : `\n${failures} target(s) FAIL.`);
process.exitCode = failures === 0 ? 0 : 1;
