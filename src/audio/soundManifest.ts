// src/audio/soundManifest.ts
import { CAR_IDS, mapCarIds, type CarId } from '../vehicle/cars';

export const SOUND_MANIFEST_URL = '/sound/manifest.json';
export const SOUND_BASE_URL = '/sound/';

export type LayerName = 'idle' | 'low' | 'mid' | 'high';
export const LAYER_NAMES: readonly LayerName[] = ['idle', 'low', 'mid', 'high'];

/** One recorded engine loop: where it lives, the rpm it was recorded at, and where it came from. */
export interface SoundEntry {
  id: string;
  /** The layer this loop was cut for; the picker still offers it on every layer. */
  layer: LayerName;
  file: string;
  rpm: number;
  sourceId: number;
  sourceStart: number;
  sourceEnd: number;
  licence: string;
  note: string;
}

export interface SoundManifest {
  sets: Readonly<Record<CarId, readonly SoundEntry[]>>;
  byId: ReadonlyMap<string, SoundEntry>;
}

export class SoundManifestError extends Error {
  constructor(message: string) {
    super(`sound manifest: ${message}`);
    this.name = 'SoundManifestError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLayerName = (value: unknown): value is LayerName =>
  typeof value === 'string' && LAYER_NAMES.some((name) => name === value);

function stringField(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') throw new SoundManifestError(`${where}.${key} must be a non-empty string`);
  return value;
}

function numberField(record: Record<string, unknown>, key: string, where: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new SoundManifestError(`${where}.${key} must be a finite number`);
  return value;
}

function parseEntry(value: unknown, where: string): SoundEntry {
  if (!isRecord(value)) throw new SoundManifestError(`${where} must be an object`);
  const layer = value.layer;
  if (!isLayerName(layer)) throw new SoundManifestError(`${where}.layer must be one of ${LAYER_NAMES.join(', ')}`);
  const rpm = numberField(value, 'rpm', where);
  if (rpm <= 0) throw new SoundManifestError(`${where}.rpm must be positive, got ${rpm}`);
  return {
    id: stringField(value, 'id', where),
    layer,
    file: stringField(value, 'file', where),
    rpm,
    sourceId: numberField(value, 'sourceId', where),
    sourceStart: numberField(value, 'sourceStart', where),
    sourceEnd: numberField(value, 'sourceEnd', where),
    licence: stringField(value, 'licence', where),
    note: stringField(value, 'note', where),
  };
}

/** Reads the JSON of public/sound/manifest.json; any missing set or field throws with its path. */
export function parseSoundManifest(json: unknown): SoundManifest {
  if (!isRecord(json) || !isRecord(json.sets)) throw new SoundManifestError('expected an object with "sets"');
  const rawSets = json.sets;
  const byId = new Map<string, SoundEntry>();
  const parseSet = (carId: CarId): SoundEntry[] => {
    const raw = rawSets[carId];
    if (!Array.isArray(raw) || raw.length === 0) throw new SoundManifestError(`sets.${carId} must be a non-empty array`);
    return raw.map((item, index) => {
      const entry = parseEntry(item, `sets.${carId}[${index}]`);
      if (byId.has(entry.id)) throw new SoundManifestError(`the id "${entry.id}" appears twice`);
      byId.set(entry.id, entry);
      return entry;
    });
  };
  const sets = mapCarIds(parseSet);
  for (const carId of CAR_IDS) {
    for (const name of LAYER_NAMES) {
      if (!sets[carId].some((entry) => entry.layer === name)) throw new SoundManifestError(`sets.${carId} has no "${name}" loop`);
    }
  }
  return { sets, byId };
}

export function soundEntryFor(manifest: SoundManifest, id: string): SoundEntry {
  const entry = manifest.byId.get(id);
  if (!entry) throw new SoundManifestError(`there is no loop with the id "${id}"`);
  return entry;
}
