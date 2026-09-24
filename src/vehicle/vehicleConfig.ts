// src/vehicle/vehicleConfig.ts
// A heavy mid-size SUV (Pajero-Sport-ish): planted, deliberate, "drives like an iron".
export const vehicleConfig = {
  chassis: { hx: 1.0, hy: 0.6, hz: 2.1, mass: 1600 },

  // Low centre of mass + large angular inertia → heavy, stable, hard to flip.
  com: { x: 0, y: -0.7, z: 0 },
  inertia: { x: 2900, y: 3100, z: 1700 },
  linearDamping: 0.08,
  angularDamping: 0.9,

  wheel: {
    radius: 0.44,
    width: 0.45,
    suspensionRestLength: 0.5,
    suspensionStiffness: 34,        // stiffer springs for a heavy vehicle
    suspensionCompression: 0.85,
    suspensionRelaxation: 0.9,
    maxSuspensionTravel: 0.55,
    frictionSlip: 3.4,              // grippy, planted
    positions: [
      { x: -1.0, y: -0.40, z: 1.4 },  // front-left
      { x: 1.0, y: -0.40, z: 1.4 },   // front-right
      { x: -1.0, y: -0.40, z: -1.4 }, // rear-left
      { x: 1.0, y: -0.40, z: -1.4 },  // rear-right
    ],
  },

  engineForce: 15000,   // strong, but the big mass makes acceleration slow and weighty
  brakeForce: 7000,
  maxSpeed: 15,         // u/s — engine force tapers to 0 near this, so top speed is modest
  maxSteer: 0.42,
  steerSpeed: 2.2,      // slow steering ramp → heavy, deliberate turn-in
  steeredWheels: [0, 1],
  drivenWheels: [0, 1, 2, 3], // AWD

  restitution: 0.12,
  friction: 0.6,
};
