// src/vehicle/vehicleConfig.ts
import type { Cover } from '../world/biome';
import type { CarId } from './cars';
import { WORLD_GRAVITY, type DrivetrainSpec } from '../../shared/drivetrain';

export interface VehicleConfig {
  chassis: { hx: number; hy: number; hz: number; mass: number };
  com: { x: number; y: number; z: number };
  inertia: { x: number; y: number; z: number };
  linearDamping: number;
  angularDamping: number;
  wheel: {
    radius: number;
    width: number;
    suspensionRestLength: number;
    suspensionStiffness: number;
    suspensionCompression: number;
    suspensionRelaxation: number;
    maxSuspensionTravel: number;
    /** Per wheel, N. Rapier's default (6000 N) is below the car's weight, so it rests on its belly. */
    maxSuspensionForce: number;
    frictionSlip: number;
    positions: readonly { x: number; y: number; z: number }[];
  };
  drivetrain: DrivetrainSpec;
  /** Total brake force at full pedal, N; the tyres' grip may limit it further. */
  brakeForce: number;
  maxSteer: number;
  steerSpeed: number;
  /** Full lock is reduced at speed so a full turn asks for at most this sideways acceleration, m/s². */
  maxLateralAcceleration: number;
  /** Height (m) of the centre of mass above the roll axis: more = more body lean in turns. */
  rollMomentArm: number;
  steeredWheels: readonly number[];
  drivenWheels: readonly number[];
  restitution: number;
  friction: number;
  gripOverrides: Partial<Record<Cover, number>>;
}

const KMH = 1 / 3.6;

// Mitsubishi Pajero Sport 2.5 DI-D (4D56, 178 PS) with the 5-speed automatic: heavy, planted,
// strong low-rpm torque, stronger than the Forester on soft sand and steep rock.
export const PAJERO_CONFIG: VehicleConfig = {
  chassis: { hx: 1.0, hy: 0.6, hz: 2.1, mass: 2000 + 75 },

  // Low centre of mass + large angular inertia → heavy, stable, hard to flip. Inertia scales with
  // the mass so the car turns and rolls as it did at 1600 kg.
  com: { x: 0, y: -0.7, z: 0 },
  inertia: { x: 3760, y: 4020, z: 2200 },
  // Air drag and rolling resistance are real forces now, so no extra linear damping.
  linearDamping: 0,
  angularDamping: 0.9,

  wheel: {
    radius: 0.44,
    width: 0.45,
    suspensionRestLength: 0.5,
    suspensionStiffness: 34,
    suspensionCompression: 0.85,
    suspensionRelaxation: 0.9,
    maxSuspensionTravel: 0.55,
    maxSuspensionForce: 60000,
    frictionSlip: 3.4,
    positions: [
      { x: -1.0, y: -0.40, z: 1.4 },  // front-left
      { x: 1.0, y: -0.40, z: 1.4 },   // front-right
      { x: -1.0, y: -0.40, z: -1.4 }, // rear-left
      { x: 1.0, y: -0.40, z: -1.4 },  // rear-right
    ],
  },

  drivetrain: {
    engine: {
      idleRpm: 750,
      cutOffRpm: 4500,
      torqueCurve: [
        { rpm: 0, torque: 150 }, { rpm: 750, torque: 170 }, { rpm: 1000, torque: 210 },
        { rpm: 1500, torque: 290 }, { rpm: 1800, torque: 350 }, { rpm: 3500, torque: 350 },
        { rpm: 4000, torque: 313 }, { rpm: 4300, torque: 270 }, { rpm: 4500, torque: 0 },
      ],
    },
    gearbox: {
      kind: 'automatic',
      ratios: [3.52, 2.042, 1.4, 1.0, 0.716],
      upshiftRpm: 4000,
      kickdownRpm: 2900,
      coastDownshiftRpm: 1300,
      shiftSeconds: 0.35,
      shiftTorqueFactor: 0.5,
      launchRpm: 2300,
      rpmRiseRate: 6000,
      rpmFallRate: 8000,
    },
    finalDrive: 3.917,
    reverseRatio: 3.224,
    converter: { stallMultiplier: 1.9, couplingSpeedRatio: 0.85 },
    efficiency: 0.85,
    tyreRadius: 0.389, // 265/70 R16
    rotatingMassFactor: 1.13,
    topSpeed: 180 * KMH,
    reverseTopSpeed: 30 * KMH,
    engineBrakeForce: 450,
    dragCoefficient: 0.41,
    frontalArea: 2.8,
    tyrePeakFriction: 0.9,
  },
  brakeForce: 19000,
  maxSteer: 0.42,
  steerSpeed: 2.2,      // slow steering ramp → heavy, deliberate turn-in
  maxLateralAcceleration: 9,
  rollMomentArm: 0.7,
  steeredWheels: [0, 1],
  drivenWheels: [0, 1, 2, 3], // AWD

  restitution: 0.12,
  friction: 0.6,

  gripOverrides: { sand: 0.75, mud: 0.62, rock: 0.95, gravel: 0.95 },
};

// Subaru Forester 2.5i (SK, FB25, Lineartronic CVT, symmetrical AWD). Wheel geometry is the
// converted model's own (wheelbase 2.66, track 1.564, tyre 0.3555), so the body fits at scale 1.
export const FORESTER_CONFIG: VehicleConfig = {
  chassis: { hx: 0.9, hy: 0.55, hz: 2.25, mass: 1590 + 75 },

  com: { x: 0, y: -0.85, z: 0 },
  inertia: { x: 2500, y: 2700, z: 1400 },
  linearDamping: 0,
  angularDamping: 1.1,

  wheel: {
    radius: 0.36,
    width: 0.25,
    suspensionRestLength: 0.6,
    suspensionStiffness: 42,
    suspensionCompression: 1.0,
    suspensionRelaxation: 1.1,
    maxSuspensionTravel: 0.45,
    maxSuspensionForce: 50000,
    frictionSlip: 3.2,
    positions: [
      { x: -0.782, y: -0.34, z: 1.33 },
      { x: 0.782, y: -0.34, z: 1.33 },
      { x: -0.782, y: -0.34, z: -1.33 },
      { x: 0.782, y: -0.34, z: -1.33 },
    ],
  },

  drivetrain: {
    engine: {
      idleRpm: 750,
      cutOffRpm: 6300,
      // FB25: 239 Nm at 4400 rpm, 136 kW at 5800 rpm.
      torqueCurve: [
        { rpm: 0, torque: 140 }, { rpm: 750, torque: 150 }, { rpm: 1500, torque: 185 },
        { rpm: 2500, torque: 216 }, { rpm: 3500, torque: 233 }, { rpm: 4400, torque: 239 },
        { rpm: 5000, torque: 236 }, { rpm: 5800, torque: 224 }, { rpm: 6200, torque: 208 },
        { rpm: 6300, torque: 0 },
      ],
    },
    gearbox: {
      kind: 'cvt',
      lowRatio: 3.581,
      highRatio: 0.57,
      launchRpm: 3000,
      holdRpm: 5800,
      holdRpmSpeed: 110 * KMH,
      rpmRiseRate: 9000,
      rpmFallRate: 5000,
    },
    finalDrive: 4.111,
    reverseRatio: 3.667,
    converter: { stallMultiplier: 1.4, couplingSpeedRatio: 0.85 },
    efficiency: 0.8,
    tyreRadius: 0.3555,
    rotatingMassFactor: 1.1,
    topSpeed: 190 * KMH,
    reverseTopSpeed: 30 * KMH,
    engineBrakeForce: 350,
    dragCoefficient: 0.33,
    frontalArea: 2.6,
    tyrePeakFriction: 0.9,
  },
  brakeForce: 16500,
  maxSteer: 0.5,
  steerSpeed: 3.2,
  maxLateralAcceleration: 11,
  rollMomentArm: 0.3,
  steeredWheels: [0, 1],
  drivenWheels: [0, 1, 2, 3],

  restitution: 0.12,
  friction: 0.6,

  gripOverrides: { sand: 0.55, mud: 0.45, rock: 0.8, gravel: 0.85, road: 1.0 },
};

/**
 * Suspension length of a car standing still on flat ground. Rapier's spring pushes with
 * stiffness × compression × chassis mass per wheel, so the mass cancels and only gravity is left.
 */
export function restingSuspensionLength(
  wheel: Pick<VehicleConfig['wheel'], 'suspensionRestLength' | 'suspensionStiffness' | 'positions'>,
): number {
  return wheel.suspensionRestLength - WORLD_GRAVITY / (wheel.positions.length * wheel.suspensionStiffness);
}

const CONFIG_BY_CAR: Record<CarId, VehicleConfig> = {
  forester: FORESTER_CONFIG,
  pajero: PAJERO_CONFIG,
};

export function vehicleConfigFor(carId: CarId): VehicleConfig {
  return CONFIG_BY_CAR[carId];
}
