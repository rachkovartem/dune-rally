// shared/surfaceTyre.test.ts
// Category 1 (pure): the tyre on loose ground. The numbers of SURFACE_TYRE are tuning, so these rows
// check the shape of each rule (where it starts, which way it goes, where it stops), not the values.
import { describe, it, expect } from 'vitest';
import {
  SURFACE_TYRE,
  bodySlipOf,
  countersteer,
  rollingDirection,
  sideGrip,
  sinkEffects,
  sinkStep,
  slipAngle,
  spinAllowance,
  spinStep,
  staticSinkage,
  type SideGripInput,
  type SinkStepInput,
  type SpinStepInput,
} from './surfaceTyre';

const STEP = 1 / 60;

const spinInput = (change: Partial<SpinStepInput>): SpinStepInput => ({
  spin: 0,
  spinDirection: 1,
  drive: 1,
  direction: 1,
  demandedForce: 4000,
  peakTraction: 5000,
  looseness: 1,
  allowance: 2,
  spinInertia: 100,
  drivenInContact: true,
  dt: STEP,
  ...change,
});

describe('spinStep — wheelspin above the grip, held by traction control (SH-1)', () => {
  it('passes the whole demand to the ground while it fits under the peak (the grip path is unchanged)', () => {
    expect(spinStep(spinInput({ demandedForce: 4999 }))).toEqual({ spin: 0, spinDirection: 1, tyreForce: 4999 });
  });

  it('does not spin exactly at the peak, and starts to spin just above it', () => {
    expect(spinStep(spinInput({ demandedForce: 5000 })).spin).toBe(0);
    expect(spinStep(spinInput({ demandedForce: 5001 })).spin).toBeGreaterThan(0);
  });

  it('on firm ground passes exactly the peak when the demand is above it (regression: the launch bench)', () => {
    // Looseness 0 must act like the old traction clamp, or every road launch time changes.
    const result = spinStep(spinInput({ looseness: 0, demandedForce: 9000, spin: SURFACE_TYRE.fullSlideSpin }));
    expect(result.tyreForce).toBe(5000);
  });

  it('passes less than the peak while the tyre slides on loose ground', () => {
    const result = spinStep(spinInput({ looseness: 1, demandedForce: 9000, spin: SURFACE_TYRE.fullSlideSpin }));
    expect(result.tyreForce).toBeLessThan(5000);
    expect(result.tyreForce).toBeGreaterThan(0);
  });

  it('keeps the drive direction in the force when the car reverses', () => {
    expect(spinStep(spinInput({ direction: -1, spinDirection: -1, demandedForce: -9000, looseness: 0 })).tyreForce).toBe(-5000);
  });

  it('never lets the spin pass the traction-control allowance, however large the demand', () => {
    let spin = 0;
    for (let step = 0; step < 600; step++) spin = spinStep(spinInput({ spin, demandedForce: 1e6 })).spin;
    expect(spin).toBeCloseTo(2, 9);
  });

  it('lets the spin grow past that allowance with traction control off, up to the hard stop', () => {
    let spin = 0;
    for (let step = 0; step < 6000; step++) spin = spinStep(spinInput({ spin, demandedForce: 1e6, allowance: null })).spin;
    expect(spin).toBe(SURFACE_TYRE.maxSpin);
  });

  it('drops the spin to 0 when the pedal is released', () => {
    expect(spinStep(spinInput({ spin: 1.5, drive: 0 })).spin).toBe(0);
  });

  it('forgets the old spin when the drive changes direction', () => {
    expect(spinStep(spinInput({ spin: 1.5, spinDirection: 1, direction: -1, demandedForce: -1000 })).spin).toBe(0);
  });

  it('keeps the spin as it was while the driven wheels are in the air', () => {
    expect(spinStep(spinInput({ spin: 1.5, drivenInContact: false, demandedForce: 1e6 })).spin).toBe(1.5);
  });
});

describe('spinAllowance — how much spin traction control allows (SH-1)', () => {
  const car = { spinAllowance: 1.5, spinAllowanceRatio: 0.3 };
  const otherCar = { spinAllowance: 3, spinAllowanceRatio: 0.6 };

  it('is the same for every car on firm ground (looseness 0)', () => {
    expect(spinAllowance(car, 0, 10)).toBe(spinAllowance(otherCar, 0, 10));
  });

  it('is the car\'s own value on the loosest ground (looseness 1)', () => {
    expect(spinAllowance(car, 1, 0)).toBeCloseTo(car.spinAllowance, 12);
    expect(spinAllowance(car, 1, 10) - spinAllowance(car, 1, 0)).toBeCloseTo(10 * car.spinAllowanceRatio, 12);
  });

  it('grows in a straight line with speed, and the same backward as forward', () => {
    const at = (speed: number): number => spinAllowance(car, 0.6, speed);
    expect(at(20) - at(10)).toBeCloseTo(at(10) - at(0), 12);
    expect(at(-7)).toBe(at(7));
  });

  it('treats a looseness above 1 as 1', () => {
    expect(spinAllowance(car, 3, 5)).toBe(spinAllowance(car, 1, 5));
  });
});

const sideInput = (change: Partial<SideGripInput>): SideGripInput => ({
  configFrictionSlip: 2.4,
  grip: 0.6,
  lateralFactor: 1,
  looseness: 1,
  rear: false,
  tailLooseness: 0.3,
  slipAngle: 0,
  lateralSlipSpeed: 0,
  spin: 0,
  usedFriction: 0,
  scrubLoss: 0,
  ...change,
});

describe('sideGrip — side grip of one wheel (SH-1)', () => {
  it('keeps the config side friction times the grip on firm ground, with a stiff constraint (road handling unchanged)', () => {
    expect(sideGrip(sideInput({ looseness: 0, grip: 1, slipAngle: 0.05 }))).toEqual({ frictionSlip: 2.4, stiffness: 1 });
  });

  it.each([0.5, 1])('uses the real loose-ground tyre from looseness %s on, whatever the car\'s config value', (looseness) => {
    const one = sideGrip(sideInput({ looseness, configFrictionSlip: 2.4, lateralFactor: 0.75 })).frictionSlip;
    const other = sideGrip(sideInput({ looseness, configFrictionSlip: 5, lateralFactor: 0.75 })).frictionSlip;
    expect(one).toBeCloseTo(other, 12);
    expect(one).toBeCloseTo(SURFACE_TYRE.looseSideFriction * 0.6 * 0.75, 12);
  });

  it('gives the rear less side grip than the front on the loosest ground, by the car\'s tail looseness', () => {
    const front = sideGrip(sideInput({ rear: false })).frictionSlip;
    const rear = sideGrip(sideInput({ rear: true })).frictionSlip;
    expect(rear / front).toBeCloseTo(1 - 0.3, 12);
  });

  it('loses side grip only past the peak slip angle', () => {
    const atZero = sideGrip(sideInput({ slipAngle: 0 })).frictionSlip;
    expect(sideGrip(sideInput({ slipAngle: SURFACE_TYRE.peakSlipLoose })).frictionSlip).toBe(atZero);
    expect(sideGrip(sideInput({ slipAngle: SURFACE_TYRE.peakSlipLoose + 0.2 })).frictionSlip).toBeLessThan(atZero);
  });

  it('keeps a floor of side grip when the drive uses all the friction, and stays finite with no load', () => {
    const free = sideGrip(sideInput({})).frictionSlip;
    const allUsed = sideGrip(sideInput({ usedFriction: 50 })).frictionSlip;
    const noLoad = sideGrip(sideInput({ usedFriction: Number.POSITIVE_INFINITY })).frictionSlip;
    expect(allUsed).toBeGreaterThan(0);
    expect(allUsed).toBeLessThan(free);
    expect(Number.isFinite(noLoad)).toBe(true);
    expect(noLoad).toBe(allUsed);
  });

  it('takes side grip away from a spinning driven wheel', () => {
    expect(sideGrip(sideInput({ spin: 5 })).frictionSlip).toBeLessThan(sideGrip(sideInput({ spin: 0 })).frictionSlip);
  });

  it('softens the rear constraint only once the rear passes its peak slip, so the car still runs straight', () => {
    const frontStiffness = sideGrip(sideInput({ rear: false })).stiffness;
    expect(sideGrip(sideInput({ rear: true, slipAngle: 0.01 })).stiffness).toBe(frontStiffness);
    expect(sideGrip(sideInput({ rear: true, slipAngle: 0.5 })).stiffness).toBeLessThan(frontStiffness);
  });
});

describe('slipAngle — how far a tyre moves across its heading (SH-1)', () => {
  it.each([0.1, -0.25, 0.4])('reads the steer angle %s back as the slip of a car rolling straight on', (steer) => {
    const heading = { x: Math.sin(steer), y: 0, z: Math.cos(steer) };
    const axle = { x: Math.cos(steer), y: 0, z: -Math.sin(steer) };
    expect(slipAngle({ x: 0, y: 0, z: 12 }, heading, axle)).toBeCloseTo(Math.abs(steer), 9);
  });

  it('stays finite and small for a standing car nudged sideways', () => {
    const angle = slipAngle({ x: 0.1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 });
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeLessThan(0.1);
    expect(slipAngle({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 })).toBe(0);
  });
});

const sinkInput = (change: Partial<SinkStepInput>): SinkStepInput => ({
  sink: 0,
  digDirection: 1,
  softness: 1,
  flotation: 1,
  speed: 0,
  moving: 0,
  spin: 0,
  driveDirection: 1,
  radius: 0.33,
  dt: STEP,
  ...change,
});

function sinkAfter(steps: number, change: Partial<SinkStepInput>): number {
  let state = { sink: change.sink ?? 0, digDirection: change.digDirection ?? 1 };
  for (let step = 0; step < steps; step++) state = sinkStep(sinkInput({ ...change, ...state }));
  return state.sink;
}

describe('sinkStep — a wheel digs into soft sand and climbs out (SH-1)', () => {
  it('lifts a sunk wheel all the way out on firm ground', () => {
    expect(sinkAfter(600, { softness: 0, sink: 0.15 })).toBe(0);
  });

  it('settles a standing wheel at its static depth on soft sand, and no deeper', () => {
    const settled = staticSinkage(1, 1, 0);
    expect(settled).toBeGreaterThan(0);
    expect(sinkAfter(600, {})).toBeCloseTo(settled, 9);
  });

  it('does not dig with a spin up to the free spin, and digs with more', () => {
    const settled = staticSinkage(1, 1, 0);
    expect(sinkAfter(300, { spin: SURFACE_TYRE.freeSpin, moving: 1 })).toBeCloseTo(settled, 9);
    expect(sinkAfter(300, { spin: 5, moving: 1 })).toBeGreaterThan(settled + 0.01);
  });

  it('never sinks a wheel deeper than 0.6 of its radius', () => {
    const deepest = sinkAfter(6000, { spin: 20, moving: 1 });
    expect(deepest).toBeCloseTo(SURFACE_TYRE.maxSinkShare * 0.33, 9);
  });

  it('remembers the way it dug while digging forward of the rut', () => {
    expect(sinkStep(sinkInput({ spin: 5, moving: -1, driveDirection: -1, digDirection: 1 })).digDirection).toBe(-1);
  });

  it('keeps the old dig direction while it spins on its own rut', () => {
    // Deep in a rut dug going forward, now reversing out of it.
    expect(sinkStep(sinkInput({ sink: 0.12, spin: 5, moving: -1, driveDirection: -1, digDirection: 1 })).digDirection).toBe(1);
  });

  it('digs less and climbs out faster when it rolls back over its own rut', () => {
    const deep = 0.12;
    const digFresh = sinkStep(sinkInput({ sink: deep, spin: 5, moving: -1, digDirection: -1 })).sink - deep;
    const digOwn = sinkStep(sinkInput({ sink: deep, spin: 5, moving: -1, digDirection: 1 })).sink - deep;
    expect(digOwn).toBeGreaterThan(0);
    expect(digOwn).toBeLessThan(digFresh);
    const climbFresh = deep - sinkStep(sinkInput({ sink: deep, speed: -2, moving: -1, digDirection: -1 })).sink;
    const climbOwn = deep - sinkStep(sinkInput({ sink: deep, speed: -2, moving: -1, digDirection: 1 })).sink;
    expect(climbFresh).toBeGreaterThan(0);
    expect(climbOwn).toBeGreaterThan(climbFresh);
  });
});

describe('rollingDirection — which way the wheels roll (SH-1)', () => {
  it.each<[number, number, 1 | -1, -1 | 0 | 1]>([
    [3, 0, -1, 1],
    [-3, 1, 1, -1],
    [0, 0, -1, 0],
    // Regression: at a standstill with the pedal pressed the direction comes from the pedal, or
    // the reverse escape from a dug-in stop never starts.
    [0, 1, -1, -1],
    [0.01, 1, 1, 1],
  ])('speed %s, drive %s, direction %s → %s', (speed, drive, direction, expected) => {
    expect(rollingDirection(speed, drive, direction)).toBe(expected);
  });
});

describe('sinkEffects — what the sinkage costs (SH-1)', () => {
  const base = { staticSink: 0.02, radius: 0.33, baseRollingResistance: 0.08, drivenWheels: [0, 1], ownTrack: [false, false, false, false] };

  it('costs nothing while every wheel sits at its static depth', () => {
    expect(sinkEffects({ ...base, sinks: [0.02, 0.02, 0.02, 0.02] })).toEqual({ rollingResistance: 0.08, gripFactor: 1 });
  });

  it('costs nothing for a car with no wheels reported', () => {
    expect(sinkEffects({ ...base, sinks: [], drivenWheels: [] })).toEqual({ rollingResistance: 0.08, gripFactor: 1 });
  });

  it('adds rolling resistance for the depth above static, less of it on the car\'s own track', () => {
    const sinks = [0.12, 0.12, 0.12, 0.12];
    const fresh = sinkEffects({ ...base, sinks }).rollingResistance;
    const ownTrack = sinkEffects({ ...base, sinks, ownTrack: [true, true, true, true] }).rollingResistance;
    expect(fresh).toBeGreaterThan(0.08);
    expect(ownTrack).toBeLessThan(fresh);
  });

  it('takes grip away only when the driven wheels are deep, more the deeper they are', () => {
    const halfDeep = sinkEffects({ ...base, sinks: [0.1, 0.1, 0.02, 0.02] }).gripFactor;
    const fullDeep = sinkEffects({ ...base, sinks: [0.2, 0.2, 0.02, 0.02] }).gripFactor;
    expect(sinkEffects({ ...base, sinks: [0.02, 0.02, 0.2, 0.2] }).gripFactor).toBe(1);
    expect(halfDeep).toBeLessThan(1);
    expect(fullDeep).toBeLessThan(halfDeep);
    expect(fullDeep).toBeGreaterThan(0);
  });
});

describe('countersteer — the assist steers into a slide (SH-1)', () => {
  const degrees = (value: number): number => (value * Math.PI) / 180;

  it('leaves the steering alone for a slide of up to 4 degrees', () => {
    expect(countersteer(0.2, degrees(4), 15, 0.6)).toBe(0.2);
    expect(countersteer(0.2, degrees(-4), 15, 0.6)).toBe(0.2);
  });

  it('turns the front wheels against the sign of the slide past 4 degrees', () => {
    expect(countersteer(0, degrees(12), 15, 0.6)).toBeLessThan(0);
    expect(countersteer(0, degrees(-12), 15, 0.6)).toBeGreaterThan(0);
  });

  it('never steers past full lock', () => {
    expect(countersteer(-0.6, degrees(60), 15, 0.6)).toBe(-0.6);
    expect(countersteer(0.6, degrees(-60), 15, 0.6)).toBe(0.6);
  });

  it('does nothing at walking speed (3 m/s and below)', () => {
    expect(countersteer(0.1, degrees(30), 3, 0.6)).toBe(0.1);
  });

  it('agrees in sign with bodySlipOf: the assist reduces a slide it measures', () => {
    // Car nose along +z, moving +z and to the driver's right (−x).
    const slip = bodySlipOf({ x: -3, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }, 10);
    expect(Math.abs(slip)).toBeGreaterThan(degrees(4));
    const straight = bodySlipOf({ x: 0, y: 0, z: 10 }, { x: 0, y: 0, z: 1 }, 10);
    expect(straight).toBe(0);
    expect(Math.sign(countersteer(0, slip, 10, 0.6))).toBe(-Math.sign(slip));
  });
});
