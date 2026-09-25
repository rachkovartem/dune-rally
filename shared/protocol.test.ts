// shared/protocol.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PLAYER_NAME, PLAYER_NAME_MAX_LENGTH, POSE_MAX_SINK, POSE_MAX_SPIN, sanitizeCarId, sanitizeInput, sanitizeJoinOptions,
  sanitizePlayerName, sanitizePose,
} from './protocol';
import { DEFAULT_CAR_ID } from '../src/vehicle/cars';

describe('sanitizeInput', () => {
  it('passes through valid values', () => {
    expect(sanitizeInput({ throttle: 1, brake: 0, steer: -0.5 })).toEqual({ throttle: 1, brake: 0, steer: -0.5 });
  });
  it('clamps out-of-range values', () => {
    expect(sanitizeInput({ throttle: 5, brake: -2, steer: 9 })).toEqual({ throttle: 1, brake: 0, steer: 1 });
  });
  it('zeros missing or non-finite fields', () => {
    expect(sanitizeInput(undefined)).toEqual({ throttle: 0, brake: 0, steer: 0 });
    expect(sanitizeInput({ throttle: NaN, steer: Infinity })).toEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});

describe('sanitizeInput — traction control and the drive mode from the wire (SH-2, drive modes)', () => {
  // A plain object, so the test can send what a hostile or broken client would.
  const fromWire = (extra: Record<string, unknown>): ReturnType<typeof sanitizeInput> =>
    sanitizeInput(Object.assign({ throttle: 1, brake: 0, steer: 0 }, extra));

  it.each([true, false])('keeps traction control %s', (tractionControl) => {
    expect(fromWire({ tractionControl }).tractionControl).toBe(tractionControl);
  });

  it.each<[string, unknown]>([['missing (an old client)', undefined], ['the text "false"', 'false'], ['the number 0', 0], ['null', null]])(
    'leaves traction control unset (so it stays on) when it is %s',
    (_name, tractionControl) => {
      expect('tractionControl' in fromWire({ tractionControl })).toBe(false);
    },
  );

  it.each(['2H', '4H', '4HLc', '4LLc'])('keeps the known drive mode %s', (driveMode) => {
    expect(fromWire({ driveMode }).driveMode).toBe(driveMode);
  });

  it.each<[string, unknown]>([['a wrong-case mode', '4llc'], ['an empty string', ''], ['a number', 4], ['missing', undefined]])(
    'drops %s, so the car keeps its current mode',
    (_name, driveMode) => {
      expect('driveMode' in fromWire({ driveMode })).toBe(false);
    },
  );
});

describe('sanitizeCarId — the protocol boundary for a car choice (R112, R113)', () => {
  it.each(['forester', 'pajero'])('keeps the known car id "%s"', (carId) => {
    expect(sanitizeCarId(carId)).toBe(carId);
  });

  it.each<[string, unknown]>([
    ['a wrong-case id', 'FORESTER'],
    ['an empty string', ''],
    ['null', null],
    ['undefined (an old client sends no car)', undefined],
    ['a number', 7],
    ['an object', {}],
    ['an id with a trailing space', 'pajero '],
  ])('gives the default car for %s', (_name, raw) => {
    // An old client, a typo or a hostile message still gets a car instead of a crash.
    expect(sanitizeCarId(raw)).toBe(DEFAULT_CAR_ID);
  });
});

describe('sanitizePose — a driver\'s pose from the wire (S1-X)', () => {
  const VALID = { x: 1500, y: 12, z: 2000, qx: 0, qy: 1, qz: 0, qw: 0, vx: 3, vy: 0, vz: -20 };

  it('keeps a valid pose', () => {
    expect(sanitizePose(VALID)).toEqual(VALID);
  });

  it('scales a slightly long rotation back to unit length', () => {
    const pose = sanitizePose({ ...VALID, qy: 1.05 });
    expect(pose).not.toBeNull();
    expect(Math.hypot(pose?.qx ?? 0, pose?.qy ?? 0, pose?.qz ?? 0, pose?.qw ?? 0)).toBeCloseTo(1, 12);
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a number', 5],
    ['a missing field', { ...VALID, vz: undefined }],
    ['a NaN field', { ...VALID, x: Number.NaN }],
    ['an infinite field', { ...VALID, y: Number.POSITIVE_INFINITY }],
    ['a field sent as text', { ...VALID, z: '2000' }],
    ['a position far outside any map', { ...VALID, x: 1e6 }],
    ['a speed no car can reach', { ...VALID, vx: 400 }],
    ['a zero rotation', { ...VALID, qy: 0 }],
    ['a rotation twice too long', { ...VALID, qy: 2 }],
  ])('drops %s', (_name, raw) => {
    // A broken or hostile pose must never move the server copy into NaN or out of the world.
    expect(sanitizePose(raw)).toBeNull();
  });
});

describe('sanitizePose — the surface state of the driver\'s car (SH-5)', () => {
  const VALID = { x: 1500, y: 12, z: 2000, qx: 0, qy: 1, qz: 0, qw: 0, vx: 3, vy: 0, vz: -20 };
  const SURFACE = { spin: 4.5, sink: [0.1, 0.12, 0.02, 0.02], digDirection: [1, 1, -1, -1] };

  it('keeps a valid surface state with the pose', () => {
    expect(sanitizePose({ ...VALID, surface: SURFACE })?.surface).toEqual(SURFACE);
  });

  it('keeps a pose from an old client that sends no surface', () => {
    const pose = sanitizePose(VALID);
    expect(pose).not.toBeNull();
    expect(pose?.surface).toBeUndefined();
  });

  it('clamps the spin and every sinkage into their ranges', () => {
    const surface = sanitizePose({ ...VALID, surface: { ...SURFACE, spin: 99, sink: [-1, 0.3, 5, 0] } })?.surface;
    expect(surface?.spin).toBe(POSE_MAX_SPIN);
    expect(surface?.sink).toEqual([0, 0.3, POSE_MAX_SINK, 0]);
    expect(sanitizePose({ ...VALID, surface: { ...SURFACE, spin: -3 } })?.surface?.spin).toBe(0);
  });

  it('maps every dig direction to 1 or -1', () => {
    expect(sanitizePose({ ...VALID, surface: { ...SURFACE, digDirection: [0, -0.2, 7, -9] } })?.surface?.digDirection).toEqual([1, -1, 1, -1]);
  });

  it.each<[string, unknown]>([
    ['a NaN spin', { ...SURFACE, spin: Number.NaN }],
    ['a missing spin', { sink: SURFACE.sink, digDirection: SURFACE.digDirection }],
    ['three sinkages', { ...SURFACE, sink: [0, 0, 0] }],
    ['five dig directions', { ...SURFACE, digDirection: [1, 1, 1, 1, 1] }],
    ['a sinkage sent as text', { ...SURFACE, sink: ['0.1', 0, 0, 0] }],
    ['an infinite dig direction', { ...SURFACE, digDirection: [1, 1, 1, Number.POSITIVE_INFINITY] }],
    ['a surface that is not an object', 'deep'],
  ])('drops a surface with %s but keeps the pose', (_name, surface) => {
    const pose = sanitizePose({ ...VALID, surface });
    expect(pose).not.toBeNull();
    expect(pose?.surface).toBeUndefined();
  });
});

describe('sanitizeInput — a message that is not an object (release review)', () => {
  it.each<[string, unknown]>([['null', null], ['a string', 'throttle'], ['an array', [1, 0, 0]], ['a number', 1]])(
    'gives the neutral input for %s: no pedals, no steering',
    (_name, raw) => {
      expect(sanitizeInput(raw)).toStrictEqual({ throttle: 0, brake: 0, steer: 0 });
    },
  );

  it('zeros a pedal sent as text instead of a number', () => {
    expect(sanitizeInput({ throttle: '1', brake: 0, steer: 0 })).toStrictEqual({ throttle: 0, brake: 0, steer: 0 });
  });
});

describe('sanitizePlayerName — the name other players see (release review)', () => {
  it.each<[string, unknown]>([['undefined', undefined], ['null', null], ['a number', 42], ['an object', { name: 'Ann' }], ['an array', ['Ann']]])(
    'gives the default name for %s',
    (_name, raw) => {
      expect(sanitizePlayerName(raw)).toBe(DEFAULT_PLAYER_NAME);
    },
  );

  it.each<[string, string]>([['an empty string', ''], ['spaces only', '    '], ['tabs and new lines only', '\t\n\r'], ['control characters only', '\u0000\u0007\u001b']])(
    'gives the default name for %s',
    (_name, raw) => {
      expect(sanitizePlayerName(raw)).toBe(DEFAULT_PLAYER_NAME);
    },
  );

  it.each<[string, string, string]>([
    ['a NUL byte', 'Al\u0000ice', 'Alice'],
    ['a new line', 'Bob\nSmith', 'BobSmith'],
    ['an escape sequence', '\u001b[31mRed', '[31mRed'],
    ['a DEL and a C1 control', 'Ka\u007fte\u009b', 'Kate'],
  ])('removes %s from the name', (_name, raw, expected) => {
    expect(sanitizePlayerName(raw)).toBe(expected);
  });

  it('trims spaces around the name but keeps the ones inside', () => {
    expect(sanitizePlayerName('  Dune Rider  ')).toBe('Dune Rider');
  });

  it('keeps a name of exactly the maximum length', () => {
    const name = 'a'.repeat(PLAYER_NAME_MAX_LENGTH);
    expect(sanitizePlayerName(name)).toBe(name);
  });

  it('cuts a name one character over the maximum', () => {
    expect(sanitizePlayerName('a'.repeat(PLAYER_NAME_MAX_LENGTH) + 'b')).toBe('a'.repeat(PLAYER_NAME_MAX_LENGTH));
  });

  it('keeps an emoji whole when it is the last character that fits', () => {
    const name = sanitizePlayerName(`${'a'.repeat(PLAYER_NAME_MAX_LENGTH - 1)}😀b`);
    expect(name).toBe(`${'a'.repeat(PLAYER_NAME_MAX_LENGTH - 1)}😀`);
  });

  it('counts an emoji as one character, so a name of emoji only is not cut at half the limit', () => {
    const name = '😀'.repeat(PLAYER_NAME_MAX_LENGTH);
    expect(sanitizePlayerName(name)).toBe(name);
  });

  it('drops a space left at the end by the cut', () => {
    expect(sanitizePlayerName(`${'a'.repeat(PLAYER_NAME_MAX_LENGTH - 1)} b`)).toBe('a'.repeat(PLAYER_NAME_MAX_LENGTH - 1));
  });
});

describe('sanitizeJoinOptions — what a join may choose (release review)', () => {
  it('keeps only the name and the car, whatever else the join carries', () => {
    expect(sanitizeJoinOptions({ name: 'Ann', carId: 'pajero', seed: 7, maxClients: 999 })).toStrictEqual({ name: 'Ann', carId: 'pajero' });
  });

  it.each<[string, unknown]>([['no options', undefined], ['null', null], ['a string', 'Ann'], ['an array', ['Ann', 'pajero']]])(
    'gives the default name and car for %s',
    (_name, raw) => {
      expect(sanitizeJoinOptions(raw)).toStrictEqual({ name: DEFAULT_PLAYER_NAME, carId: DEFAULT_CAR_ID });
    },
  );

  it('cleans the name and the car of a join the same way as on their own', () => {
    expect(sanitizeJoinOptions({ name: ' \u0000Ann ', carId: 'FORESTER' })).toStrictEqual({ name: 'Ann', carId: DEFAULT_CAR_ID });
  });
});
