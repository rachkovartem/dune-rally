// shared/drivetrain.test.ts
import { describe, it, expect } from 'vitest';
import {
  PEDAL_SWITCH_SPEED,
  aeroDragForce,
  converterMultiplier,
  createDrivetrainState,
  driveForce,
  drivenLoadShare,
  engineTorqueAt,
  longitudinalForce,
  pedalIntent,
  stepGearbox,
  wheelRpmAt,
  withRotatingMass,
  type AutomaticSpec,
  type CvtSpec,
  type DrivetrainSpec,
  type DrivetrainState,
  type DriveLayout,
  type EngineSpec,
  type LongitudinalInput,
  type PedalIntent,
} from './drivetrain';

// Synthetic round-number specs: the rules are checked on their own, not the tuned car numbers.
const ENGINE: EngineSpec = {
  idleRpm: 800,
  cutOffRpm: 6000,
  torqueCurve: [
    { rpm: 0, torque: 100 },
    { rpm: 2000, torque: 200 },
    { rpm: 4000, torque: 300 },
    { rpm: 6000, torque: 0 },
  ],
};

const CVT: CvtSpec = {
  kind: 'cvt',
  lowRatio: 3.5,
  highRatio: 0.5,
  launchRpm: 3000,
  holdRpm: 5000,
  holdRpmSpeed: 30,
  rpmRiseRate: 1e6,
  rpmFallRate: 1e6,
};

const AUTOMATIC: AutomaticSpec = {
  kind: 'automatic',
  ratios: [3, 2, 1.4, 1],
  upshiftRpm: 4000,
  kickdownRpm: 2500,
  coastDownshiftRpm: 1200,
  shiftSeconds: 0.4,
  shiftTorqueFactor: 0.5,
  launchRpm: 2000,
  rpmRiseRate: 1e6,
  rpmFallRate: 1e6,
};

function specWith(gearbox: CvtSpec | AutomaticSpec): DrivetrainSpec {
  return {
    engine: ENGINE,
    gearbox,
    finalDrive: 4,
    reverseRatio: 3,
    converter: { stallMultiplier: 2, couplingSpeedRatio: 0.8 },
    efficiency: 0.9,
    tyreRadius: 0.35,
    rotatingMassFactor: 1.1,
    topSpeed: 50,
    reverseTopSpeed: 8,
    engineBrakeForce: 400,
    dragCoefficient: 0.35,
    frontalArea: 2.5,
    tyrePeakFriction: 0.9,
  };
}

const CVT_SPEC = specWith(CVT);
const AUTOMATIC_SPEC = specWith(AUTOMATIC);
const FULL_FORWARD: PedalIntent = { drive: 1, brake: 0, direction: 1 };
const COASTING: PedalIntent = { drive: 0, brake: 0, direction: 1 };
const DT = 1 / 60;

/** Engine rpm the wheels force through a ratio at a speed. */
const coupledRpm = (spec: DrivetrainSpec, speed: number, ratio: number): number => wheelRpmAt(spec, speed) * ratio * spec.finalDrive;

function settleAt(spec: DrivetrainSpec, state: DrivetrainState, intent: PedalIntent, speed: number, steps = 30): DrivetrainState {
  let current = state;
  for (let step = 0; step < steps; step++) current = stepGearbox(spec, current, intent, speed, DT);
  return current;
}

describe('engineTorqueAt — full-throttle torque curve', () => {
  it.each<[string, number, number]>([
    ['at a curve point', 2000, 200],
    ['halfway between two points (linear)', 3000, 250],
    ['at 0 rpm', 0, 100],
    ['exactly at the cut-off', 6000, 0],
    ['above the cut-off', 7000, 0],
    ['a negative rpm', -100, 0],
    ['NaN', Number.NaN, 0],
  ])('%s → %s rpm gives %s Nm', (_name, rpm, torque) => {
    expect(engineTorqueAt(ENGINE, rpm)).toBeCloseTo(torque, 9);
  });
});

describe('pedalIntent — automatic-car pedals', () => {
  const just = 1e-6;
  it.each<[string, number, number, number, PedalIntent]>([
    ['nothing pressed', 0, 0, 0, { drive: 0, brake: 0, direction: 1 }],
    ['gas at a standstill drives forward', 1, 0, 0, { drive: 1, brake: 0, direction: 1 }],
    ['brake at a standstill engages reverse', 0, 1, 0, { drive: 1, brake: 0, direction: -1 }],
    ['brake exactly at the switch speed still reverses', 0, 1, PEDAL_SWITCH_SPEED, { drive: 1, brake: 0, direction: -1 }],
    ['brake just above the switch speed brakes', 0, 1, PEDAL_SWITCH_SPEED + just, { drive: 0, brake: 1, direction: 1 }],
    ['gas exactly at minus the switch speed still drives forward', 1, 0, -PEDAL_SWITCH_SPEED, { drive: 1, brake: 0, direction: 1 }],
    ['gas while rolling backwards faster brakes first', 0.6, 0, -PEDAL_SWITCH_SPEED - just, { drive: 0, brake: 0.6, direction: -1 }],
    ['both pedals: the brake wins, no drive', 1, 0.7, 10, { drive: 0, brake: 0.7, direction: 1 }],
    ['both pedals while reversing', 1, 0.7, -3, { drive: 0, brake: 0.7, direction: -1 }],
    ['coasting backwards keeps the reverse direction', 0, 0, -3, { drive: 0, brake: 0, direction: -1 }],
  ])('%s', (_name, throttle, brake, speed, expected) => {
    expect(pedalIntent(throttle, brake, speed)).toEqual(expected);
  });
});

describe('wheelRpmAt', () => {
  it('turns one tyre circumference per second into 60 rpm, in either direction', () => {
    const circumferencePerSecond = 2 * Math.PI * CVT_SPEC.tyreRadius;
    expect(wheelRpmAt(CVT_SPEC, circumferencePerSecond)).toBeCloseTo(60, 9);
    expect(wheelRpmAt(CVT_SPEC, -circumferencePerSecond)).toBeCloseTo(60, 9);
    expect(wheelRpmAt(CVT_SPEC, 0)).toBe(0);
  });
});

describe('stepGearbox — CVT (the Forester)', () => {
  it('starts in the lowest ratio at idle rpm', () => {
    const state = createDrivetrainState(CVT_SPEC);
    expect(state).toEqual({ rpm: ENGINE.idleRpm, gear: 1, ratio: CVT.lowRatio, shiftTimer: 0 });
  });

  it('holds the engine at holdRpm under full throttle while the speed keeps rising', () => {
    // The CVT sound and pull depend on this: rpm stays flat, the ratio does the work.
    let state = createDrivetrainState(CVT_SPEC);
    const readings: DrivetrainState[] = [];
    for (let speed = CVT.holdRpmSpeed; speed <= CVT.holdRpmSpeed + 15; speed += 1) {
      state = settleAt(CVT_SPEC, state, FULL_FORWARD, speed);
      readings.push(state);
    }
    for (const reading of readings) expect(reading.rpm).toBeCloseTo(CVT.holdRpm, 6);
    for (let index = 1; index < readings.length; index++) {
      expect(readings[index].ratio).toBeLessThan(readings[index - 1].ratio);
    }
  });

  it('launches at launchRpm from a standstill', () => {
    const state = settleAt(CVT_SPEC, createDrivetrainState(CVT_SPEC), FULL_FORWARD, 0);
    expect(state.rpm).toBeCloseTo(CVT.launchRpm, 6);
    expect(state.ratio).toBe(CVT.lowRatio);
  });

  it('lets the wheels drag the engine up once the belt is at its tallest ratio', () => {
    // Past this speed even the tallest ratio turns the engine faster than holdRpm.
    const tooFastForHold = 110;
    const state = settleAt(CVT_SPEC, createDrivetrainState(CVT_SPEC), FULL_FORWARD, tooFastForHold);
    expect(state.ratio).toBeCloseTo(CVT.highRatio, 9);
    expect(state.rpm).toBeCloseTo(coupledRpm(CVT_SPEC, tooFastForHold, CVT.highRatio), 6);
    expect(state.rpm).toBeGreaterThan(CVT.holdRpm);
  });

  it('never lets the engine fall below idle, and never leaves the ratio range', () => {
    let state = createDrivetrainState(CVT_SPEC);
    for (const speed of [0, 0.1, 3, 20, 45]) {
      for (const intent of [FULL_FORWARD, COASTING, { drive: 0.3, brake: 0, direction: 1 } as const]) {
        state = settleAt(CVT_SPEC, state, intent, speed, 5);
        expect(state.rpm).toBeGreaterThanOrEqual(ENGINE.idleRpm);
        expect(state.ratio).toBeGreaterThanOrEqual(CVT.highRatio - 1e-9);
        expect(state.ratio).toBeLessThanOrEqual(CVT.lowRatio + 1e-9);
      }
    }
  });

  it('moves the rpm no faster than the rise rate allows', () => {
    const slowCvt = specWith({ ...CVT, rpmRiseRate: 1200 });
    const state = stepGearbox(slowCvt, createDrivetrainState(slowCvt), FULL_FORWARD, 0, 0.5);
    expect(state.rpm).toBeCloseTo(ENGINE.idleRpm + 600, 6);
  });

  it('engages reverse gear with the reverse ratio', () => {
    const state = stepGearbox(CVT_SPEC, createDrivetrainState(CVT_SPEC), { drive: 1, brake: 0, direction: -1 }, -2, DT);
    expect(state.gear).toBe(-1);
    expect(state.ratio).toBe(CVT_SPEC.reverseRatio);
  });
});

describe('stepGearbox — stepped automatic (the Pajero)', () => {
  const inGear = (gear: number, rpm: number, shiftTimer = 0): DrivetrainState =>
    ({ rpm, gear, ratio: AUTOMATIC.ratios[gear - 1], shiftTimer });
  /** Speed at which a gear turns the engine at `rpm`. */
  const speedFor = (gear: number, rpm: number): number =>
    (rpm / (AUTOMATIC.ratios[gear - 1] * AUTOMATIC_SPEC.finalDrive)) * (2 * Math.PI * AUTOMATIC_SPEC.tyreRadius) / 60;

  it('upshifts once the wheels turn the engine to upshiftRpm, and the rpm drops', () => {
    // The Pajero's engine sound steps down on every shift instead of climbing smoothly.
    const speed = speedFor(1, AUTOMATIC.upshiftRpm);
    const shifted = stepGearbox(AUTOMATIC_SPEC, inGear(1, AUTOMATIC.upshiftRpm), FULL_FORWARD, speed, DT);
    expect(shifted.gear).toBe(2);
    expect(shifted.shiftTimer).toBeCloseTo(AUTOMATIC.shiftSeconds, 9);
    expect(shifted.rpm).toBeLessThan(AUTOMATIC.upshiftRpm);
    expect(shifted.rpm).toBeCloseTo(coupledRpm(AUTOMATIC_SPEC, speed, AUTOMATIC.ratios[1]), 6);
  });

  it('stays in gear just below upshiftRpm', () => {
    const speed = speedFor(1, AUTOMATIC.upshiftRpm - 1);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(1, 3999), FULL_FORWARD, speed, DT).gear).toBe(1);
  });

  it('does not shift again while a shift is still running', () => {
    const speed = speedFor(2, AUTOMATIC.upshiftRpm + 200);
    const state = stepGearbox(AUTOMATIC_SPEC, inGear(2, 4200, 0.3), FULL_FORWARD, speed, DT);
    expect(state.gear).toBe(2);
    expect(state.shiftTimer).toBeCloseTo(0.3 - DT, 9);
  });

  it('never upshifts past the top gear', () => {
    const top = AUTOMATIC.ratios.length;
    const speed = speedFor(top, AUTOMATIC.upshiftRpm + 500);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(top, 4500), FULL_FORWARD, speed, DT).gear).toBe(top);
  });

  it('kicks down under throttle when the lower gear would still turn below kickdownRpm', () => {
    const speed = speedFor(2, AUTOMATIC.kickdownRpm - 100);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(3, 2000), FULL_FORWARD, speed, DT).gear).toBe(2);
  });

  it('keeps the gear under throttle when the lower gear would turn above kickdownRpm', () => {
    const speed = speedFor(2, AUTOMATIC.kickdownRpm + 100);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(3, 2000), FULL_FORWARD, speed, DT).gear).toBe(3);
  });

  it('drops a gear while coasting once the engine falls below coastDownshiftRpm', () => {
    const below = speedFor(3, AUTOMATIC.coastDownshiftRpm - 50);
    const above = speedFor(3, AUTOMATIC.coastDownshiftRpm + 50);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(3, 1150), COASTING, below, DT).gear).toBe(2);
    expect(stepGearbox(AUTOMATIC_SPEC, inGear(3, 1250), COASTING, above, DT).gear).toBe(3);
  });

  it('comes out of reverse into first gear when driving forward again', () => {
    const reversing: DrivetrainState = { rpm: 1500, gear: -1, ratio: AUTOMATIC_SPEC.reverseRatio, shiftTimer: 0 };
    const state = stepGearbox(AUTOMATIC_SPEC, reversing, FULL_FORWARD, 0, DT);
    expect(state.gear).toBe(1);
    expect(state.ratio).toBe(AUTOMATIC.ratios[0]);
  });

  it('climbs through every gear in order during a long full-throttle run', () => {
    let state = createDrivetrainState(AUTOMATIC_SPEC);
    const gearsSeen: number[] = [state.gear];
    for (let speed = 0; speed <= 45; speed += 0.05) {
      state = stepGearbox(AUTOMATIC_SPEC, state, FULL_FORWARD, speed, DT);
      if (state.gear !== gearsSeen[gearsSeen.length - 1]) gearsSeen.push(state.gear);
    }
    expect(gearsSeen).toEqual([1, 2, 3, 4]);
  });
});

describe('converterMultiplier — torque converter', () => {
  it('multiplies fully at stall (wheels still)', () => {
    expect(converterMultiplier(CVT_SPEC, 3000, 0)).toBe(2);
  });

  it('is exactly 1 at the coupling speed ratio and above', () => {
    expect(converterMultiplier(CVT_SPEC, 3000, 3000 * 0.8)).toBeCloseTo(1, 12);
    expect(converterMultiplier(CVT_SPEC, 3000, 3000)).toBe(1);
    expect(converterMultiplier(CVT_SPEC, 3000, 9000)).toBe(1);
  });

  it('falls steadily from stall to coupling', () => {
    const values = [0, 600, 1200, 1800, 2400].map((coupled) => converterMultiplier(CVT_SPEC, 3000, coupled));
    for (let index = 1; index < values.length; index++) expect(values[index]).toBeLessThan(values[index - 1]);
  });

  it.each([0, -10, Number.NaN])('gives 1 instead of NaN for an engine rpm of %s', (engineRpm) => {
    expect(converterMultiplier(CVT_SPEC, engineRpm, 100)).toBe(1);
  });
});

describe('driveForce — engine force at the tyres', () => {
  const cruising: DrivetrainState = { rpm: 4000, gear: 1, ratio: 1, shiftTimer: 0 };

  it('is zero without throttle', () => {
    expect(driveForce(CVT_SPEC, cruising, COASTING, 10)).toBe(0);
  });

  it('pushes toward the nose going forward and toward the tail in reverse', () => {
    expect(driveForce(CVT_SPEC, cruising, FULL_FORWARD, 5)).toBeGreaterThan(0);
    expect(driveForce(CVT_SPEC, cruising, { drive: 1, brake: 0, direction: -1 }, -2)).toBeLessThan(0);
  });

  it('scales with the pedal share', () => {
    const half = driveForce(CVT_SPEC, cruising, { drive: 0.5, brake: 0, direction: 1 }, 5);
    expect(half).toBeCloseTo(driveForce(CVT_SPEC, cruising, FULL_FORWARD, 5) / 2, 6);
  });

  it('keeps full force at the governed top speed and fades it to 0 just above', () => {
    const atTop = driveForce(CVT_SPEC, cruising, FULL_FORWARD, CVT_SPEC.topSpeed);
    const wellBelow = driveForce(CVT_SPEC, cruising, FULL_FORWARD, CVT_SPEC.topSpeed - 5);
    expect(atTop).toBeGreaterThan(0);
    expect(driveForce(CVT_SPEC, cruising, FULL_FORWARD, CVT_SPEC.topSpeed + 0.1)).toBeLessThan(atTop);
    expect(driveForce(CVT_SPEC, cruising, FULL_FORWARD, CVT_SPEC.topSpeed + 0.1)).toBeGreaterThan(0);
    expect(driveForce(CVT_SPEC, cruising, FULL_FORWARD, CVT_SPEC.topSpeed + 1)).toBe(0);
    expect(wellBelow).toBeGreaterThan(0);
  });

  it('governs reverse at the reverse top speed', () => {
    const backwards = { drive: 1, brake: 0, direction: -1 } as const;
    expect(Math.abs(driveForce(CVT_SPEC, cruising, backwards, -(CVT_SPEC.reverseTopSpeed + 1)))).toBe(0);
    expect(driveForce(CVT_SPEC, cruising, backwards, -(CVT_SPEC.reverseTopSpeed - 1))).toBeLessThan(0);
  });

  it('cuts the torque while an automatic shifts', () => {
    const steady: DrivetrainState = { rpm: 3000, gear: 2, ratio: AUTOMATIC.ratios[1], shiftTimer: 0 };
    const shifting: DrivetrainState = { ...steady, shiftTimer: 0.2 };
    const steadyForce = driveForce(AUTOMATIC_SPEC, steady, FULL_FORWARD, 15);
    expect(driveForce(AUTOMATIC_SPEC, shifting, FULL_FORWARD, 15)).toBeCloseTo(steadyForce * AUTOMATIC.shiftTorqueFactor, 6);
  });

  it('gives no force at or above the engine cut-off', () => {
    const overRevving: DrivetrainState = { ...cruising, rpm: ENGINE.cutOffRpm };
    expect(driveForce(CVT_SPEC, overRevving, FULL_FORWARD, 5)).toBe(0);
  });
});

describe('withRotatingMass', () => {
  const mass = 1500;

  it('leaves the force alone when the driver is not on the gas', () => {
    expect(withRotatingMass(CVT_SPEC, -3000, -200, COASTING)).toBe(-3000);
  });

  it('accelerates a plain-mass body as if it weighed mass × rotatingMassFactor', () => {
    const tyreForce = 6000;
    const aero = -500;
    const handed = withRotatingMass(CVT_SPEC, tyreForce, aero, FULL_FORWARD);
    const plainBodyAcceleration = (handed + aero) / mass;
    const heavierBodyAcceleration = (tyreForce + aero) / (mass * CVT_SPEC.rotatingMassFactor);
    expect(plainBodyAcceleration).toBeCloseTo(heavierBodyAcceleration, 9);
  });

  it('does not change the top speed: at balance the net force stays 0', () => {
    const aero = -2400;
    expect(withRotatingMass(CVT_SPEC, 2400, aero, FULL_FORWARD) + aero).toBeCloseTo(0, 9);
  });
});

describe('aeroDragForce', () => {
  it('is 0 at a standstill and grows with the square of speed', () => {
    expect(aeroDragForce(CVT_SPEC, 0)).toBe(0);
    expect(aeroDragForce(CVT_SPEC, 20)).toBeCloseTo(4 * aeroDragForce(CVT_SPEC, 10), 9);
  });
});

describe('longitudinalForce — tyre force along the car', () => {
  const base: LongitudinalInput = {
    driveForce: 0,
    intent: COASTING,
    forwardSpeed: 10,
    grip: 1,
    rollingResistance: 0.015,
    normalForce: 15000,
    // Replacement (E2): an AWD car drives through every wheel, so its driven load is the whole load.
    drivenNormalForce: 15000,
    brakeForce: 20000,
    mass: 1500,
    dt: DT,
  };
  const traction = (grip: number): number => CVT_SPEC.tyrePeakFriction * grip * base.normalForce;

  it('limits the drive to what the tyres can hold on the ground', () => {
    const force = longitudinalForce(CVT_SPEC, { ...base, driveForce: 1e6, intent: FULL_FORWARD, grip: 0.5 });
    expect(force).toBeCloseTo(traction(0.5) - base.rollingResistance * base.normalForce, 6);
  });

  it('lets a weak push at a standstill do nothing: rolling resistance holds but never pushes back', () => {
    const rolling = base.rollingResistance * base.normalForce;
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 0, driveForce: rolling * 0.9, intent: FULL_FORWARD })).toBe(0);
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 0, driveForce: 0 })).toBe(0);
  });

  it('lets a strong push at a standstill start the car, minus the rolling resistance', () => {
    const rolling = base.rollingResistance * base.normalForce;
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 0, driveForce: 3000, intent: FULL_FORWARD })).toBeCloseTo(3000 - rolling, 6);
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 0, driveForce: -3000, intent: { drive: 1, brake: 0, direction: -1 } }))
      .toBeCloseTo(-3000 + rolling, 6);
  });

  it('never brakes harder than the tyres grip', () => {
    const force = longitudinalForce(CVT_SPEC, { ...base, intent: { drive: 0, brake: 1, direction: 1 }, forwardSpeed: 30, grip: 0.4 });
    const rolling = base.rollingResistance * base.normalForce;
    expect(force).toBeCloseTo(-(traction(0.4) + rolling + CVT_SPEC.engineBrakeForce), 6);
  });

  it('stops a slow car within one step but never pushes it backwards', () => {
    const creeping = 0.1;
    const force = longitudinalForce(CVT_SPEC, { ...base, intent: { drive: 0, brake: 1, direction: 1 }, forwardSpeed: creeping });
    expect(force).toBeLessThan(0);
    expect(Math.abs(force)).toBeCloseTo((base.mass * creeping) / base.dt, 6);
  });

  it('adds engine braking only while the driver is off the gas', () => {
    const rolling = base.rollingResistance * base.normalForce;
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 20 })).toBeCloseTo(-(rolling + CVT_SPEC.engineBrakeForce), 6);
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: 20, driveForce: 5000, intent: FULL_FORWARD })).toBeCloseTo(5000 - rolling, 6);
  });

  it('resists against the direction of travel when rolling backwards', () => {
    expect(longitudinalForce(CVT_SPEC, { ...base, forwardSpeed: -5, intent: { drive: 0, brake: 0, direction: -1 } })).toBeGreaterThan(0);
  });
});

describe('longitudinalForce — a car that drives through one axle (E2)', () => {
  const base: LongitudinalInput = {
    driveForce: 0,
    intent: COASTING,
    forwardSpeed: 10,
    grip: 1,
    rollingResistance: 0.015,
    normalForce: 15000,
    drivenNormalForce: 15000,
    brakeForce: 20000,
    mass: 1500,
    dt: DT,
  };
  const frontAxleLoad = 9000;

  it('limits the push to what the driven wheels hold, not to the load on all four', () => {
    // A front-driven car on sand must spin its front wheels long before an AWD car would.
    const force = longitudinalForce(CVT_SPEC, { ...base, drivenNormalForce: frontAxleLoad, driveForce: 1e6, intent: FULL_FORWARD });
    const rolling = base.rollingResistance * base.normalForce;
    expect(force).toBeCloseTo(CVT_SPEC.tyrePeakFriction * frontAxleLoad - rolling, 6);
  });

  it('still brakes with the grip of all four wheels', () => {
    const intent: PedalIntent = { drive: 0, brake: 1, direction: 1 };
    const oneAxle = longitudinalForce(CVT_SPEC, { ...base, drivenNormalForce: frontAxleLoad, intent, forwardSpeed: 30, grip: 0.4 });
    const allWheels = longitudinalForce(CVT_SPEC, { ...base, intent, forwardSpeed: 30, grip: 0.4 });
    expect(oneAxle).toBeCloseTo(allWheels, 9);
  });

  it('pushes no harder than zero when the driven wheels carry no load', () => {
    const force = longitudinalForce(CVT_SPEC, { ...base, drivenNormalForce: 0, forwardSpeed: 0, driveForce: 5000, intent: FULL_FORWARD });
    expect(force).toBe(0);
  });
});

describe('drivenLoadShare — share of the weight on the driven wheels (E2)', () => {
  const AWD: DriveLayout = { kind: 'awd' };
  const FWD: DriveLayout = { kind: 'fwd', frontLoadShare: 0.6, comHeight: 0.5 };
  const WHEELBASE = 2.5;
  /** The nose and roof axes' world y for a car pitched `degrees` nose up. */
  const pitched = (degrees: number): [number, number] => {
    const angle = (degrees * Math.PI) / 180;
    return [Math.sin(angle), Math.cos(angle)];
  };

  it.each([
    ['flat', 0, 1],
    ['nose up 30°', Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)],
    ['nose down 30°', -Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)],
    ['on its roof', 0, -1],
  ])('gives an AWD car the whole load (%s)', (_name, noseRise, upright) => {
    expect(drivenLoadShare(AWD, WHEELBASE, noseRise, upright)).toBe(1);
  });

  it('gives a front-driven car its front axle share on flat ground', () => {
    expect(drivenLoadShare(FWD, WHEELBASE, 0, 1)).toBeCloseTo(FWD.frontLoadShare, 12);
  });

  it('moves weight off the front axle nose up by comHeight / wheelbase × tan θ', () => {
    const [noseRise, upright] = pitched(15);
    const expected = FWD.frontLoadShare - (FWD.comHeight / WHEELBASE) * Math.tan((15 * Math.PI) / 180);
    expect(drivenLoadShare(FWD, WHEELBASE, noseRise, upright)).toBeCloseTo(expected, 9);
  });

  it('puts more weight on the front axle nose down than on flat ground', () => {
    const [noseRise, upright] = pitched(-15);
    expect(drivenLoadShare(FWD, WHEELBASE, noseRise, upright)).toBeGreaterThan(FWD.frontLoadShare);
  });

  it('clamps to 0 on a very steep climb and to 1 on a very steep descent', () => {
    expect(drivenLoadShare(FWD, WHEELBASE, ...pitched(85))).toBe(0);
    expect(drivenLoadShare(FWD, WHEELBASE, ...pitched(-85))).toBe(1);
  });

  it.each([
    ['on its side (upright 0)', 0],
    ['on its roof (upright negative)', -0.5],
  ])('gives a front-driven car no driven load %s', (_name, upright) => {
    expect(drivenLoadShare(FWD, WHEELBASE, 0, upright)).toBe(0);
  });
});

describe('longitudinalForce — no drive: the resistance stops the car and holds it (release blocker)', () => {
  const base: LongitudinalInput = {
    driveForce: 0,
    intent: COASTING,
    forwardSpeed: 0,
    grip: 1,
    rollingResistance: 0.015,
    normalForce: 15000,
    drivenNormalForce: 15000,
    brakeForce: 20000,
    mass: 1500,
    dt: DT,
  };
  // With no pedal pressed the car is held by rolling resistance and engine braking only.
  const holdLimit = base.rollingResistance * base.normalForce + CVT_SPEC.engineBrakeForce;
  /** Speed along the nose after one step under the tyre force and the outside pull. */
  const speedAfterStep = (input: LongitudinalInput): number =>
    input.forwardSpeed + ((longitudinalForce(CVT_SPEC, input) + (input.externalAlongNose ?? 0)) / input.mass) * input.dt;

  /** Speeds step by step with no drive, for `seconds`. */
  const coast = (forwardSpeed: number, seconds: number): number[] => {
    const speeds: number[] = [];
    let speed = forwardSpeed;
    for (let step = 0; step < Math.round(seconds / DT); step++) {
      speed = speedAfterStep({ ...base, forwardSpeed: speed });
      speeds.push(speed);
    }
    return speeds;
  };

  it.each([0.049, 0.03, 0.001, -0.001, -0.03, -0.049])('brings a car creeping at %s m/s (below the standstill speed) to a real stop and keeps it there', (forwardSpeed) => {
    const speeds = coast(forwardSpeed, 1);
    const firstStop = speeds.findIndex((speed) => speed === 0);
    expect(firstStop).toBeGreaterThanOrEqual(0);
    expect(speeds.slice(firstStop).every((speed) => speed === 0)).toBe(true);
  });

  it.each([0.049, -0.049])('never overshoots the stop: a car creeping at %s m/s does not roll the other way', (forwardSpeed) => {
    expect(coast(forwardSpeed, 1).every((speed) => speed * forwardSpeed >= 0)).toBe(true);
  });

  it.each([0.05, 0.5, 5])('slows a car rolling at %s m/s without ever pushing it backwards', (forwardSpeed) => {
    const next = speedAfterStep({ ...base, forwardSpeed });
    expect(next).toBeLessThan(forwardSpeed);
    expect(next).toBeGreaterThanOrEqual(0);
  });

  it('gives no force to a car that stands still with nothing pulling it', () => {
    expect(longitudinalForce(CVT_SPEC, { ...base, externalAlongNose: 0 })).toBe(0);
    expect(longitudinalForce(CVT_SPEC, base)).toBe(0);
  });

  it.each([0.5, 0.99, 1])('holds a standing car against a slope pull of %s of its limit', (share) => {
    const externalAlongNose = -holdLimit * share;
    expect(speedAfterStep({ ...base, externalAlongNose })).toBeCloseTo(0, 12);
  });

  it('holds a standing car against a pull toward its nose too', () => {
    expect(speedAfterStep({ ...base, externalAlongNose: holdLimit * 0.5 })).toBeCloseTo(0, 12);
  });

  it('lets a pull stronger than its limit roll the car, resisting with the full limit', () => {
    const extra = 300;
    const input: LongitudinalInput = { ...base, externalAlongNose: -(holdLimit + extra) };
    expect(longitudinalForce(CVT_SPEC, input)).toBeCloseTo(holdLimit, 9);
    expect(speedAfterStep(input)).toBeCloseTo((-extra / base.mass) * DT, 12);
  });

  it('holds against a stronger pull when the brake is pressed', () => {
    const externalAlongNose = -(holdLimit + 300);
    const braked: LongitudinalInput = { ...base, intent: { drive: 0, brake: 1, direction: 1 }, externalAlongNose };
    expect(speedAfterStep(braked)).toBeCloseTo(0, 12);
  });

  it.each([
    ['standing, pulled toward the nose', 0, 2000],
    ['rolling forward, pulled toward the nose', 1, 2000],
    ['rolling forward, pulled back', 0.02, -2000],
    ['standing, pulled back', 0, -2000],
  ])('never pushes the car along with the motion when %s', (_name, forwardSpeed, externalAlongNose) => {
    const force = longitudinalForce(CVT_SPEC, { ...base, forwardSpeed, externalAlongNose });
    const motion = (base.mass * forwardSpeed) / base.dt + externalAlongNose;
    expect(Math.sign(force)).not.toBe(Math.sign(motion));
  });
});
