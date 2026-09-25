// src/audio/soundChoice.test.ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOLUME,
  RECORDED_RPM_MAX,
  RECORDED_RPM_MIN,
  defaultSoundSettings,
  isValidRecordedRpm,
  parseSoundSettings,
  recordedRpmOf,
  serializeSoundSettings,
  type SoundSettings,
} from './soundChoice';
import { LAYER_NAMES, parseSoundManifest, type LayerName } from './soundManifest';
import { CAR_IDS, type CarId } from '../vehicle/cars';

// A manifest that holds the default loops plus one spare loop per car.
function testManifest() {
  const defaults = defaultSoundSettings().choices;
  const setFor = (carId: CarId) => [
    ...LAYER_NAMES.map((layer: LayerName, index) => ({
      id: defaults[carId].layers[layer], layer, file: 'x.wav', rpm: 700 + index * 900,
      sourceId: 1, sourceStart: 0, sourceEnd: 1, licence: 'CC0', note: 'default',
    })),
    { id: `${carId}-spare`, layer: 'mid', file: 'y.wav', rpm: 2222, sourceId: 2, sourceStart: 0, sourceEnd: 1, licence: 'CC0', note: 'spare' },
  ];
  // Replacement (E3): every car in CAR_IDS needs its own set, the Elantra included.
  return parseSoundManifest({ sets: Object.fromEntries(CAR_IDS.map((carId) => [carId, setFor(carId)])) });
}
const manifest = testManifest();

const stored = (value: unknown): string => JSON.stringify(value);

describe('parseSoundSettings — what the listening page saved', () => {
  it('gives the defaults and no warnings when nothing was saved', () => {
    expect(parseSoundSettings(null, manifest)).toEqual({ settings: defaultSoundSettings(), warnings: [] });
  });

  it('gives the defaults with a warning for text that is not JSON', () => {
    const parsed = parseSoundSettings('{oops', manifest);
    expect(parsed.settings).toEqual(defaultSoundSettings());
    expect(parsed.warnings[0]).toContain('not JSON');
  });

  it('gives the defaults with a warning for JSON that is not an object', () => {
    const parsed = parseSoundSettings('[1, 2]', manifest);
    expect(parsed.settings).toEqual(defaultSoundSettings());
    expect(parsed.warnings).toEqual(['saved sound settings are not an object']);
  });

  it('round-trips a changed choice with no warnings', () => {
    const settings: SoundSettings = defaultSoundSettings();
    settings.volume = 0.3;
    settings.choices.pajero.layers.mid = 'pajero-spare';
    settings.choices.forester.recordedRpm['forester-spare'] = 2500;
    expect(parseSoundSettings(serializeSoundSettings(settings), manifest)).toEqual({ settings, warnings: [] });
  });

  it('keeps the default loop, with a warning, for a saved loop the manifest no longer has', () => {
    const parsed = parseSoundSettings(stored({ choices: { forester: { layers: { idle: 'deleted-loop' } } } }), manifest);
    expect(parsed.settings.choices.forester.layers.idle).toBe(defaultSoundSettings().choices.forester.layers.idle);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain('"deleted-loop" is not in the manifest');
  });

  it('refuses a loop from the other car\'s set', () => {
    const parsed = parseSoundSettings(stored({ choices: { forester: { layers: { mid: 'pajero-spare' } } } }), manifest);
    expect(parsed.settings.choices.forester.layers.mid).toBe(defaultSoundSettings().choices.forester.layers.mid);
    expect(parsed.warnings).toHaveLength(1);
  });

  it.each([RECORDED_RPM_MIN - 1, RECORDED_RPM_MAX + 1, -5])('ignores a saved recorded rpm of %s, with a warning', (rpm) => {
    const parsed = parseSoundSettings(stored({ choices: { pajero: { recordedRpm: { 'pajero-spare': rpm } } } }), manifest);
    expect(parsed.settings.choices.pajero.recordedRpm).toEqual({});
    expect(parsed.warnings).toHaveLength(1);
  });

  it('ignores a saved rpm for a loop id the manifest does not have', () => {
    const parsed = parseSoundSettings(stored({ choices: { pajero: { recordedRpm: { ghost: 2000 } } } }), manifest);
    expect(parsed.settings.choices.pajero.recordedRpm).toEqual({});
    expect(parsed.warnings).toHaveLength(1);
  });

  it.each([0, 1])('accepts a volume of exactly %s', (volume) => {
    const parsed = parseSoundSettings(stored({ volume }), manifest);
    expect(parsed.settings.volume).toBe(volume);
    expect(parsed.warnings).toEqual([]);
  });

  it.each([-0.1, 1.5, 'loud'])('uses the default volume, with a warning, for a saved volume of %s', (volume) => {
    const parsed = parseSoundSettings(stored({ volume }), manifest);
    expect(parsed.settings.volume).toBe(DEFAULT_VOLUME);
    expect(parsed.warnings).toHaveLength(1);
  });

  it('warns about a car choice that is not an object and keeps that car\'s defaults', () => {
    const parsed = parseSoundSettings(stored({ choices: { pajero: 'turbo' } }), manifest);
    expect(parsed.settings.choices.pajero).toEqual(defaultSoundSettings().choices.pajero);
    expect(parsed.warnings).toEqual(['pajero: saved choice is not an object']);
  });
});

describe('defaultSoundSettings', () => {
  it('hands out a fresh copy each time, so editing one choice never changes the defaults', () => {
    const edited = defaultSoundSettings();
    edited.choices.forester.layers.idle = 'changed';
    edited.choices.forester.recordedRpm.x = 1000;
    expect(defaultSoundSettings().choices.forester.layers.idle).not.toBe('changed');
    expect(defaultSoundSettings().choices.forester.recordedRpm).toEqual({});
  });

  it.each(CAR_IDS)('gives the %s a loop on every layer', (carId) => {
    const layers = defaultSoundSettings().choices[carId].layers;
    for (const layer of LAYER_NAMES) expect(layers[layer]).toBeTruthy();
  });
});

describe('recordedRpmOf', () => {
  it('uses the player\'s own rpm for a loop when there is one, else the manifest rpm', () => {
    const choice = defaultSoundSettings().choices.pajero;
    expect(recordedRpmOf(manifest, choice, 'pajero-spare')).toBe(2222);
    choice.recordedRpm['pajero-spare'] = 2600;
    expect(recordedRpmOf(manifest, choice, 'pajero-spare')).toBe(2600);
  });
});

describe('isValidRecordedRpm', () => {
  it.each([
    [RECORDED_RPM_MIN, true],
    [RECORDED_RPM_MAX, true],
    [RECORDED_RPM_MIN - 0.01, false],
    [RECORDED_RPM_MAX + 0.01, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])('%s → %s', (rpm, valid) => {
    expect(isValidRecordedRpm(rpm)).toBe(valid);
  });
});
