// src/audio/soundManifest.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { LAYER_NAMES, SoundManifestError, parseSoundManifest, soundEntryFor, type LayerName } from './soundManifest';
import { defaultCarChoice } from './soundChoice';
import { CAR_IDS, type CarId } from '../vehicle/cars';

function entry(id: string, layer: LayerName, rpm = 1000): Record<string, unknown> {
  return { id, layer, file: `${id}.wav`, rpm, sourceId: 1, sourceStart: 0, sourceEnd: 3, licence: 'CC0', note: 'test loop' };
}

const fullSet = (prefix: string): Record<string, unknown>[] => LAYER_NAMES.map((layer, index) => entry(`${prefix}-${layer}`, layer, 800 + index * 1000));

function manifestJson(overrides: Partial<Record<CarId, unknown>> = {}): { sets: Record<string, unknown> } {
  return { sets: { forester: fullSet('f'), pajero: fullSet('p'), ...overrides } };
}

describe('parseSoundManifest', () => {
  it('reads every loop of both cars and finds each by id', () => {
    const manifest = parseSoundManifest(manifestJson());
    expect(manifest.sets.forester).toHaveLength(LAYER_NAMES.length);
    expect(soundEntryFor(manifest, 'p-high').layer).toBe('high');
  });

  it.each<[string, unknown, string]>([
    ['no "sets" object', {}, 'expected an object with "sets"'],
    ['a car with no loops', manifestJson({ pajero: [] }), 'sets.pajero must be a non-empty array'],
    ['a car missing a layer', manifestJson({ forester: fullSet('f').slice(0, 3) }), 'sets.forester has no "high" loop'],
    ['a loop with a zero rpm', manifestJson({ forester: [...fullSet('f'), entry('f-zero', 'low', 0)] }), 'sets.forester[4].rpm must be positive'],
    ['a loop with an unknown layer', manifestJson({ forester: [...fullSet('f'), entry('f-odd', 'low')].map((item, index) => (index === 4 ? { ...item, layer: 'turbo' } : item)) }), 'sets.forester[4].layer must be one of'],
    ['a loop with no file', manifestJson({ forester: fullSet('f').map((item, index) => (index === 1 ? { ...item, file: '' } : item)) }), 'sets.forester[1].file must be a non-empty string'],
    ['the same id twice', manifestJson({ pajero: [...fullSet('p'), entry('f-idle', 'idle')] }), 'the id "f-idle" appears twice'],
  ])('throws for %s, naming the place in the file', (_name, json, message) => {
    expect(() => parseSoundManifest(json)).toThrow(SoundManifestError);
    expect(() => parseSoundManifest(json)).toThrow(message);
  });

  it('throws for a loop id that is not in the manifest', () => {
    expect(() => soundEntryFor(parseSoundManifest(manifestJson()), 'nope')).toThrow('there is no loop with the id "nope"');
  });
});

describe('the shipped public/sound/manifest.json', () => {
  const publicSound = new URL('../../public/sound/', import.meta.url);
  const manifest = parseSoundManifest(JSON.parse(readFileSync(new URL('manifest.json', publicSound), 'utf8')));

  it('points every loop at a file that is in the build', () => {
    for (const carId of CAR_IDS) {
      for (const loop of manifest.sets[carId]) expect(existsSync(new URL(loop.file, publicSound))).toBe(true);
    }
  });

  it.each(CAR_IDS)('holds every default loop of the %s, in that car\'s own set', (carId) => {
    // A default the manifest lost would make the engine sound throw on the first frame.
    const defaults = defaultCarChoice(carId).layers;
    for (const layer of LAYER_NAMES) {
      expect(manifest.sets[carId].map((loop) => loop.id)).toContain(defaults[layer]);
    }
  });
});
