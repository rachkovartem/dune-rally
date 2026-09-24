// src/audio/soundChoice.ts
import { CAR_IDS, type CarId } from '../vehicle/cars';
import { LAYER_NAMES, soundEntryFor, type LayerName, type SoundManifest } from './soundManifest';

export const SOUND_SETTINGS_STORAGE_KEY = 'dune-rally.sound-v1';
export const DEFAULT_VOLUME = 0.7;
export const RECORDED_RPM_MIN = 300;
export const RECORDED_RPM_MAX = 9000;

/** Which loop plays on each layer of one car, plus the rpm the player says a loop was recorded at. */
export interface CarSoundChoice {
  layers: Record<LayerName, string>;
  /** Overrides of the manifest rpm, by loop id. */
  recordedRpm: Record<string, number>;
}

export interface SoundSettings {
  volume: number;
  choices: Record<CarId, CarSoundChoice>;
}

// The prototype's picks, chosen by ear before the port.
const DEFAULT_LAYERS: Readonly<Record<CarId, Readonly<Record<LayerName, string>>>> = {
  forester: { idle: 'f-idle-outback-730', low: 'f-low-outback-1430', mid: 'f-mid-outback-2730', high: 'f-high-fa20-5000' },
  pajero: { idle: 'p-idle-pajero-exhaust-1040', low: 'p-low-tdi-1225', mid: 'p-mid-tdi-1650', high: 'p-high-peugeot-2900' },
};

export function defaultCarChoice(carId: CarId): CarSoundChoice {
  return { layers: { ...DEFAULT_LAYERS[carId] }, recordedRpm: {} };
}

export function defaultSoundSettings(): SoundSettings {
  return { volume: DEFAULT_VOLUME, choices: { forester: defaultCarChoice('forester'), pajero: defaultCarChoice('pajero') } };
}

export const isValidRecordedRpm = (value: number): boolean =>
  Number.isFinite(value) && value >= RECORDED_RPM_MIN && value <= RECORDED_RPM_MAX;

/** The rpm a loop is pitched against: the player's override, else the manifest value. */
export function recordedRpmOf(manifest: SoundManifest, choice: CarSoundChoice, id: string): number {
  return choice.recordedRpm[id] ?? soundEntryFor(manifest, id).rpm;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ParsedSoundSettings {
  settings: SoundSettings;
  /** Each saved value that was dropped, and why; the caller shows them. */
  warnings: string[];
}

function parseCarChoice(raw: unknown, carId: CarId, manifest: SoundManifest, warnings: string[]): CarSoundChoice {
  const choice = defaultCarChoice(carId);
  if (raw === undefined) return choice;
  if (!isRecord(raw)) {
    warnings.push(`${carId}: saved choice is not an object`);
    return choice;
  }
  const layers = isRecord(raw.layers) ? raw.layers : {};
  for (const name of LAYER_NAMES) {
    const id = layers[name];
    if (id === undefined) continue;
    if (typeof id === 'string' && manifest.sets[carId].some((entry) => entry.id === id)) choice.layers[name] = id;
    else warnings.push(`${carId}.${name}: saved loop "${String(id)}" is not in the manifest, the default is used`);
  }
  const recordedRpm = isRecord(raw.recordedRpm) ? raw.recordedRpm : {};
  for (const [id, value] of Object.entries(recordedRpm)) {
    if (manifest.byId.has(id) && typeof value === 'number' && isValidRecordedRpm(value)) choice.recordedRpm[id] = value;
    else warnings.push(`${carId}: saved rpm ${String(value)} for "${id}" is ignored`);
  }
  return choice;
}

/** Reads what writeSoundSettings stored; nothing stored gives the defaults with no warnings. */
export function parseSoundSettings(stored: string | null, manifest: SoundManifest): ParsedSoundSettings {
  const warnings: string[] = [];
  if (stored === null) return { settings: defaultSoundSettings(), warnings };
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch (error) {
    warnings.push(`saved sound settings are not JSON (${error instanceof Error ? error.message : String(error)})`);
    return { settings: defaultSoundSettings(), warnings };
  }
  if (!isRecord(raw)) {
    warnings.push('saved sound settings are not an object');
    return { settings: defaultSoundSettings(), warnings };
  }
  let volume = DEFAULT_VOLUME;
  if (typeof raw.volume === 'number' && raw.volume >= 0 && raw.volume <= 1) volume = raw.volume;
  else if (raw.volume !== undefined) warnings.push(`saved volume ${String(raw.volume)} is ignored`);
  const savedChoices = isRecord(raw.choices) ? raw.choices : {};
  const choices = {
    forester: parseCarChoice(savedChoices.forester, 'forester', manifest, warnings),
    pajero: parseCarChoice(savedChoices.pajero, 'pajero', manifest, warnings),
  };
  return { settings: { volume, choices }, warnings };
}

export function serializeSoundSettings(settings: SoundSettings): string {
  return JSON.stringify(settings);
}

/** What "copy choice" puts on the clipboard: the car on screen first, then every car. */
export function choiceSummaryJson(manifest: SoundManifest, settings: SoundSettings, carId: CarId): string {
  const choice = settings.choices[carId];
  const layers = Object.fromEntries(LAYER_NAMES.map((name) => {
    const id = choice.layers[name];
    return [name, { id, rpm: recordedRpmOf(manifest, choice, id) }];
  }));
  const allCars = Object.fromEntries(CAR_IDS.map((otherCarId) => [otherCarId, settings.choices[otherCarId]]));
  return JSON.stringify({ car: carId, layers, allCars, volume: settings.volume });
}
