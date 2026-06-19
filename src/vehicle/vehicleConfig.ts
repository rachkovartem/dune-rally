// src/vehicle/vehicleConfig.ts
export const vehicleConfig = {
  chassis: { hx: 1.2, hy: 0.5, hz: 2.2, mass: 800 },
  wheel: {
    radius: 0.7,
    suspensionRestLength: 0.6,
    suspensionStiffness: 30,
    maxSuspensionTravel: 0.5,
    // wheel connection points relative to chassis center (x: right, y: down, z: forward)
    positions: [
      { x: -1.1, y: -0.3, z: 1.5 },  // front-left
      { x: 1.1, y: -0.3, z: 1.5 },   // front-right
      { x: -1.1, y: -0.3, z: -1.5 }, // rear-left
      { x: 1.1, y: -0.3, z: -1.5 },  // rear-right
    ],
  },
  engineForce: 9000,
  brakeForce: 1200,
  maxSteer: 0.5, // radians
  steeredWheels: [0, 1], // front
  drivenWheels: [2, 3],  // rear
};
