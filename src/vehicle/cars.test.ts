// src/vehicle/cars.test.ts
import { describe, it, expect } from 'vitest';
import { isCarId } from './cars';

describe('isCarId (R61, R62)', () => {
  it.each(['forester', 'pajero'])('accepts "%s"', (value) => {
    expect(isCarId(value)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['a wrong-case id', 'Forester'],
    ['an empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 3],
    ['a prototype key', 'toString'],
  ])('rejects %s', (_name, value) => {
    expect(isCarId(value)).toBe(false);
  });
});
