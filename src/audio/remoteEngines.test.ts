// src/audio/remoteEngines.test.ts
import { describe, it, expect } from 'vitest';
import { RemoteDrivetrainEstimate } from './remoteEngines';
import { vehicleConfigFor } from '../vehicle/vehicleConfig';

describe('RemoteDrivetrainEstimate', () => {
  it('estimates idle rpm and zero load when stationary', () => {
    const config = vehicleConfigFor('pajero');
    const estimate = new RemoteDrivetrainEstimate(config.drivetrain);

    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    let result = estimate.step({ x: 0, y: 0, z: 0 }, rotation, 0.016);
    expect(result.rpm).toBeCloseTo(config.drivetrain.engine.idleRpm, -1);
    expect(result.load).toBe(0);

    // Keep standing still
    for (let i = 0; i < 60; i++) {
      result = estimate.step({ x: 0, y: 0, z: 0 }, rotation, 0.016);
    }
    expect(result.rpm).toBeCloseTo(config.drivetrain.engine.idleRpm, -1);
    expect(result.load).toBeCloseTo(0, 2);
    expect(result.forwardSpeed).toBeCloseTo(0, 2);
  });

  it('estimates cruising rpm and positive load when moving steadily', () => {
    const config = vehicleConfigFor('pajero');
    const estimate = new RemoteDrivetrainEstimate(config.drivetrain);

    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    let z = 0;
    const speed = 15; // 54 km/h
    const dt = 0.016;

    let result = { rpm: 0, gear: 1, load: 0, forwardSpeed: 0 };
    for (let i = 0; i < 90; i++) {
      z += speed * dt;
      result = estimate.step({ x: 0, y: 0, z }, rotation, dt);
    }

    expect(result.forwardSpeed).toBeCloseTo(speed, 0.5);
    // Cruising load should be positive (engine working to maintain speed)
    expect(result.load).toBeGreaterThan(0.15);
    // RPM should be well above idle
    expect(result.rpm).toBeGreaterThan(config.drivetrain.engine.idleRpm + 400);
  });

  it('increases load and rpm when accelerating', () => {
    const config = vehicleConfigFor('forester');
    const estimate = new RemoteDrivetrainEstimate(config.drivetrain);

    const rotation = { x: 0, y: 0, z: 0, w: 1 };
    let z = 0;
    let speed = 5;
    const dt = 0.016;

    let result = { rpm: 0, gear: 1, load: 0, forwardSpeed: 0 };
    for (let i = 0; i < 60; i++) {
      speed += 10 * dt; // accelerating by 10 m/s^2
      z += speed * dt;
      result = estimate.step({ x: 0, y: 0, z }, rotation, dt);
    }

    expect(result.load).toBeGreaterThan(0.5);
    expect(result.rpm).toBeGreaterThan(2000);
  });
});
