// src/ui/minimap.test.ts
import { describe, it, expect } from 'vitest';
import {
  carHeadingAngle,
  formatDistance,
  markerColorForCar,
  projectToRadar,
  worldToMapUV,
  RADAR_ZOOM_LEVELS,
  MINIMAP_WORLD_SIZE,
} from './minimap';

describe('worldToMapUV — converts world coordinates to normalized UV', () => {
  it('maps origin (0, 0) to (0, 0)', () => {
    const uv = worldToMapUV(0, 0);
    expect(uv.u).toBe(0);
    expect(uv.v).toBe(0);
  });

  it('maps world bounds (3072, 3072) to (1, 1)', () => {
    const uv = worldToMapUV(MINIMAP_WORLD_SIZE, MINIMAP_WORLD_SIZE);
    expect(uv.u).toBe(1);
    expect(uv.v).toBe(1);
  });

  it('maps world center (1536, 1536) to (0.5, 0.5)', () => {
    const uv = worldToMapUV(MINIMAP_WORLD_SIZE / 2, MINIMAP_WORLD_SIZE / 2);
    expect(uv.u).toBeCloseTo(0.5, 5);
    expect(uv.v).toBeCloseTo(0.5, 5);
  });

  it('clamps coordinates outside world boundaries', () => {
    expect(worldToMapUV(-500, 4000)).toEqual({ u: 0, v: 1 });
  });
});

describe('carHeadingAngle — horizontal heading angle in radians', () => {
  it('returns 0 for North (−z direction)', () => {
    expect(carHeadingAngle(0, -1)).toBeCloseTo(0, 5);
  });

  it('returns π/2 for East (+x direction)', () => {
    expect(carHeadingAngle(1, 0)).toBeCloseTo(Math.PI / 2, 5);
  });

  it('returns π for South (+z direction)', () => {
    expect(carHeadingAngle(0, 1)).toBeCloseTo(Math.PI, 5);
  });

  it('returns 3π/2 for West (−x direction)', () => {
    expect(carHeadingAngle(-1, 0)).toBeCloseTo((3 * Math.PI) / 2, 5);
  });

  it('returns 0 for zero forward vector', () => {
    expect(carHeadingAngle(0, 0)).toBe(0);
  });
});

describe('formatDistance — human-readable distance', () => {
  it('formats distances under 1 km in metres', () => {
    expect(formatDistance(50)).toBe('50 м');
    expect(formatDistance(450.4)).toBe('450 м');
    expect(formatDistance(999)).toBe('999 м');
  });

  it('formats distances between 1 km and 10 km with one decimal', () => {
    expect(formatDistance(1000)).toBe('1.0 км');
    expect(formatDistance(1250)).toBe('1.3 км');
    expect(formatDistance(4820)).toBe('4.8 км');
  });

  it('formats distances over 10 km as whole kilometres', () => {
    expect(formatDistance(12400)).toBe('12 км');
  });
});

describe('projectToRadar — projection of world points onto radar', () => {
  const radarRadiusPx = 100;
  const viewRadiusMeters = 500;

  describe('heading-up mode', () => {
    it('projects point straight ahead to screen UP (negative y)', () => {
      // Car at (1000, 1000) facing North (0, -1). Point is 200m North at (1000, 800)
      const heading = carHeadingAngle(0, -1);
      const proj = projectToRadar(1000, 1000, heading, 1000, 800, viewRadiusMeters, radarRadiusPx, true);

      expect(proj.isOffscreen).toBe(false);
      expect(proj.distanceMeters).toBeCloseTo(200, 1);
      expect(proj.x).toBeCloseTo(0, 1);
      expect(proj.y).toBeCloseTo(-40, 1); // 200m * (100px / 500m) = 40px UP
    });

    it('projects point to the right when facing North', () => {
      // Car at (1000, 1000) facing North. Target 250m East at (1250, 1000)
      const heading = carHeadingAngle(0, -1);
      const proj = projectToRadar(1000, 1000, heading, 1250, 1000, viewRadiusMeters, radarRadiusPx, true);

      expect(proj.isOffscreen).toBe(false);
      expect(proj.distanceMeters).toBeCloseTo(250, 1);
      expect(proj.x).toBeCloseTo(50, 1); // 250m * (100px / 500m) = 50px RIGHT
      expect(proj.y).toBeCloseTo(0, 1);
    });

    it('projects point straight ahead when car is facing East (+x)', () => {
      // Car at (1000, 1000) facing East (1, 0). Target 300m East at (1300, 1000)
      const heading = carHeadingAngle(1, 0);
      const proj = projectToRadar(1000, 1000, heading, 1300, 1000, viewRadiusMeters, radarRadiusPx, true);

      expect(proj.isOffscreen).toBe(false);
      expect(proj.distanceMeters).toBeCloseTo(300, 1);
      expect(proj.x).toBeCloseTo(0, 1);
      expect(proj.y).toBeCloseTo(-60, 1); // Point is straight ahead of car, so UP on radar!
    });

    it('clamps points beyond radar radius to circumference with isOffscreen = true', () => {
      // Car at (1000, 1000), target 1500m away North (1000, -500)
      const heading = carHeadingAngle(0, -1);
      const proj = projectToRadar(1000, 1000, heading, 1000, -500, viewRadiusMeters, radarRadiusPx, true);

      expect(proj.isOffscreen).toBe(true);
      expect(proj.distanceMeters).toBeCloseTo(1500, 1);
      expect(Math.hypot(proj.x, proj.y)).toBeCloseTo(radarRadiusPx, 1);
      expect(proj.x).toBeCloseTo(0, 1);
      expect(proj.y).toBeCloseTo(-radarRadiusPx, 1); // Clamped at top edge
    });
  });

  describe('north-up mode', () => {
    it('always places North at top (-y) regardless of car heading', () => {
      // Car facing South (0, 1). Target is North of car at (1000, 750)
      const heading = carHeadingAngle(0, 1);
      const proj = projectToRadar(1000, 1000, heading, 1000, 750, viewRadiusMeters, radarRadiusPx, false);

      expect(proj.isOffscreen).toBe(false);
      expect(proj.x).toBeCloseTo(0, 1);
      expect(proj.y).toBeCloseTo(-50, 1); // 250m North -> 50px UP
    });
  });
});

describe('markerColorForCar — car type specific palette', () => {
  it('returns distinct colors for forester, pajero, and elantra', () => {
    const foresterColor = markerColorForCar('forester');
    const pajeroColor = markerColorForCar('pajero');
    const elantraColor = markerColorForCar('elantra');

    expect(foresterColor).toBe('#38bdf8');
    expect(pajeroColor).toBe('#4ade80');
    expect(elantraColor).toBe('#fb7185');
    expect(new Set([foresterColor, pajeroColor, elantraColor]).size).toBe(3);
  });

  it('falls back to default color for unknown car IDs without throwing', () => {
    expect(markerColorForCar('buggy-x')).toBe('#facc15');
    expect(markerColorForCar('')).toBe('#facc15');
  });
});

describe('RADAR_ZOOM_LEVELS', () => {
  it('has ordered zoom levels with sensible distances', () => {
    expect(RADAR_ZOOM_LEVELS.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < RADAR_ZOOM_LEVELS.length; i++) {
      expect(RADAR_ZOOM_LEVELS[i]).toBeGreaterThan(RADAR_ZOOM_LEVELS[i - 1]);
    }
  });
});
