// src/vehicle/vehicleConfig.ts
export const vehicleConfig = {
  chassis: { hx: 1.1, hy: 0.45, hz: 2.1, mass: 750 },

  // Low centre of mass + solid angular inertia so the buggy leans and resists flipping.
  com: { x: 0, y: -0.8, z: 0 },
  inertia: { x: 1400, y: 1500, z: 800 },
  // Low linear damping → it coasts and carries momentum (inertia); modest angular damping so it
  // can rotate and slide naturally without feeling locked/"wooden".
  linearDamping: 0.04,
  angularDamping: 0.5,

  wheel: {
    radius: 0.6,
    width: 0.45,
    suspensionRestLength: 0.55,
    suspensionStiffness: 24,        // softer springs → wheels visibly compress over bumps
    suspensionCompression: 0.82,    // damping while compressing
    suspensionRelaxation: 0.88,     // damping while extending
    maxSuspensionTravel: 0.8,
    frictionSlip: 2.4,              // tyre grip (higher = more grip, lower = more slide/drift)
    // connection points relative to chassis centre (x: right, y: down, z: forward)
    positions: [
      { x: -1.0, y: -0.2, z: 1.35 },  // front-left
      { x: 1.0, y: -0.2, z: 1.35 },   // front-right
      { x: -1.0, y: -0.2, z: -1.35 }, // rear-left
      { x: 1.0, y: -0.2, z: -1.35 },  // rear-right
    ],
  },

  engineForce: 9000,
  brakeForce: 2600,
  maxSteer: 0.5,        // radians at full lock
  steerSpeed: 3.5,      // rad/s the steering ramps toward the target (analog feel, not a snap)
  steeredWheels: [0, 1],         // front
  drivenWheels: [0, 1, 2, 3],    // all-wheel drive → grip on dunes, less wheelie/flip

  // Chassis surface for terrain/obstacle collisions: a little bounce + friction so impacts
  // deflect and scrub speed instead of stopping dead.
  restitution: 0.2,
  friction: 0.5,
};
