// scripts/bench-cars.ts
// Prints the car comparison numbers (spec C2.6–C2.12) for both cars on road and sand grip.
// Run: npx tsx scripts/bench-cars.ts
import RAPIER from '@dimforge/rapier3d-compat';
import { CAR_IDS } from '../src/vehicle/cars';
import { vehicleConfigFor } from '../src/vehicle/vehicleConfig';
import { terrainGripFor } from '../shared/terrainGrip';
import {
  createBenchCar, runBraking, runRollover, runStraightLine, runTurn, speedAt, stepBenchCar,
} from '../shared/carBench';

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

for (const carId of CAR_IDS) {
  const config = vehicleConfigFor(carId);
  for (const surface of surfaces) {
    const grip = terrainGripFor(surface, config);
    const straight = runStraightLine(config, grip, 70);
    speedAt5[`${carId}:${surface}`] = speedAt(straight, 5);
    const braking = runBraking(config, grip, 100 / KMH);
    const fromStandstill = runTurn(config, { entrySpeed: 0, seconds: 5, steer: -1, grip });
    const at60 = runTurn(config, { entrySpeed: 60 / KMH, seconds: 5, steer: -1, grip });
    const atTop = runTurn(config, { entrySpeed: straight.topSpeed * 0.97, seconds: 3, steer: -1, grip });
    rows.push([
      carId, surface, grip.toFixed(2),
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
  const straight = runStraightLine(vehicleConfigFor(carId), 1, 12);
  const trace = straight.samples
    .filter((_, index) => (index + 1) % 60 === 0)
    .map((sample) => `${sample.time.toFixed(0)}s ${kmh(sample.speed)} km/h g${sample.gear} ${sample.rpm.toFixed(0)}rpm`);
  console.log(`${carId}: ${trace.join(' · ')}`);
}

console.log('\nSteering direction: D (steer +1) for 3 s from standstill:');
for (const carId of CAR_IDS) {
  const right = runTurn(vehicleConfigFor(carId), { entrySpeed: 0, seconds: 3, steer: 1, grip: 1 });
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
for (const carId of CAR_IDS) {
  const car = createBenchCar(vehicleConfigFor(carId));
  let slowest = 0;
  while (car.time < 8) {
    stepBenchCar(car, { throttle: 0, brake: 1, steer: 0 }, 1);
    slowest = Math.min(slowest, car.vehicle.forwardSpeed());
  }
  console.log(`${carId}: reverse speed ${kmh(-slowest)} km/h, gear ${car.vehicle.drivetrain().gear}`);
}
