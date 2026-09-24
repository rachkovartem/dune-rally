// src/audio/soundPicker.ts
import { CAR_IDS, type CarId } from '../vehicle/cars';
import { CAR_LABELS } from '../ui/carChoice';
import {
  choiceSummaryJson, isValidRecordedRpm, recordedRpmOf, RECORDED_RPM_MAX, RECORDED_RPM_MIN, type SoundSettings,
} from './soundChoice';
import { LAYER_NAMES, soundEntryFor, type LayerName, type SoundEntry, type SoundManifest } from './soundManifest';

export const SOUND_PICKER_ID = 'sound-picker';
const STYLE_ID = 'sound-picker-style';
const TOGGLE_KEY = 'KeyM';

// The panel is the only UI this module owns, so its stylesheet travels with it instead of index.html.
const STYLESHEET = `
#${SOUND_PICKER_ID} {
  position: fixed; right: 12px; top: 60px; z-index: 20; width: 440px;
  max-height: calc(100vh - 140px); overflow: auto; padding: 10px 12px; border-radius: 6px;
  background: rgba(12,14,18,0.9); color: #eee; font: 12px system-ui, sans-serif;
  box-shadow: 0 4px 18px rgba(0,0,0,0.5);
}
#${SOUND_PICKER_ID}[hidden] { display: none; }
#${SOUND_PICKER_ID} .sp-title { font-weight: 700; font-size: 13px; margin-bottom: 6px; }
#${SOUND_PICKER_ID} .sp-cars { display: flex; gap: 6px; margin-bottom: 6px; }
#${SOUND_PICKER_ID} .sp-car { font: 12px system-ui; padding: 2px 10px; border-radius: 999px; border: 1px solid #555; background: #222; color: #eee; cursor: pointer; }
#${SOUND_PICKER_ID} .sp-car.is-selected { border-color: #ffd23d; color: #ffd23d; }
#${SOUND_PICKER_ID} .sp-row { display: flex; gap: 6px; align-items: center; margin: 5px 0; }
#${SOUND_PICKER_ID} .sp-layer { width: 34px; font-weight: 600; }
#${SOUND_PICKER_ID} select, #${SOUND_PICKER_ID} input[type=number] { font: 12px system-ui; background: #222; color: #eee; border: 1px solid #555; }
#${SOUND_PICKER_ID} select { flex: 1; min-width: 0; }
#${SOUND_PICKER_ID} input[type=number] { width: 58px; }
#${SOUND_PICKER_ID} .sp-play { width: 42px; font: 12px system-ui; }
#${SOUND_PICKER_ID} .sp-note { opacity: 0.6; margin: -2px 0 4px 40px; font-size: 11px; }
#${SOUND_PICKER_ID} .sp-volume { display: flex; gap: 8px; align-items: center; margin: 8px 0 6px; }
#${SOUND_PICKER_ID} .sp-volume input { flex: 1; }
#${SOUND_PICKER_ID} .sp-actions { display: flex; gap: 6px; align-items: center; }
#${SOUND_PICKER_ID} .sp-status { opacity: 0.75; }
#${SOUND_PICKER_ID} textarea { width: 100%; box-sizing: border-box; margin-top: 6px; font: 10px monospace; background: #111; color: #9f9; border: 1px solid #444; }
`;

/** What the picker asks of the sound system; it owns no audio itself. */
export interface SoundPickerHost {
  manifest: SoundManifest;
  settings: SoundSettings;
  /** The car whose set is shown when the panel opens: the one being driven, or the chosen one. */
  currentCar(): CarId;
  save(): void;
  layerChanged(carId: CarId, name: LayerName): void;
  resetToDefaults(carId: CarId): void;
  setVolume(volume: number): void;
  /** Starts the loop alone, or stops it if it already plays; resolves to whether it plays now. */
  togglePreview(entry: SoundEntry): Promise<boolean>;
  stopPreview(): void;
}

export interface SoundPicker {
  isOpen(): boolean;
  toggle(): void;
  shownCar(): CarId;
}

function ensureStylesheet(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STYLESHEET;
  document.head.appendChild(style);
}

const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

/** The "sound picker" panel from the prototype: per layer a loop, its recorded rpm and a preview; key M. */
export function createSoundPicker(host: SoundPickerHost): SoundPicker {
  ensureStylesheet();
  const panel = document.createElement('div');
  panel.id = SOUND_PICKER_ID;
  panel.hidden = true;
  document.body.appendChild(panel);
  let shownCar: CarId = host.currentCar();

  const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
    const created = document.createElement(tag);
    if (className) created.className = className;
    if (text) created.textContent = text;
    return created;
  };

  function layerRow(name: LayerName): HTMLElement[] {
    const choice = host.settings.choices[shownCar];
    const row = element('div', 'sp-row');
    const select = element('select', '');
    select.setAttribute('aria-label', `${name} loop`);
    // Every loop of the set is offered on every layer; the layer name only says where it was cut for.
    const candidates = [...host.manifest.sets[shownCar]].sort((first, second) =>
      (first.layer === name ? 0 : 1) - (second.layer === name ? 0 : 1) || first.rpm - second.rpm);
    for (const entry of candidates) {
      const option = element('option', '', `${entry.id} · ~${entry.rpm} rpm${entry.layer === name ? '' : ` (${entry.layer})`}`);
      option.value = entry.id;
      option.title = entry.note;
      select.appendChild(option);
    }
    select.value = choice.layers[name];
    const rpmInput = element('input', '');
    rpmInput.type = 'number';
    rpmInput.step = '10';
    rpmInput.min = String(RECORDED_RPM_MIN);
    rpmInput.max = String(RECORDED_RPM_MAX);
    rpmInput.title = 'rpm this loop was recorded at; change it if the pitch sounds wrong against the engine';
    rpmInput.setAttribute('aria-label', `${name} recorded rpm`);
    rpmInput.value = String(recordedRpmOf(host.manifest, choice, choice.layers[name]));
    const play = element('button', 'sp-play', 'play');
    play.type = 'button';

    // Each control gives the focus back after a change, so W/A/S/D drive the car again at once.
    select.addEventListener('change', () => {
      choice.layers[name] = select.value;
      host.save();
      host.layerChanged(shownCar, name);
      select.blur();
      render();
    });
    rpmInput.addEventListener('change', () => {
      const value = Number(rpmInput.value);
      if (isValidRecordedRpm(value)) {
        choice.recordedRpm[choice.layers[name]] = value;
        host.save();
      } else {
        rpmInput.value = String(recordedRpmOf(host.manifest, choice, choice.layers[name]));
      }
      rpmInput.blur();
    });
    play.addEventListener('click', () => {
      for (const other of panel.querySelectorAll<HTMLButtonElement>('.sp-play')) other.textContent = 'play';
      void host.togglePreview(soundEntryFor(host.manifest, select.value)).then((playing) => {
        play.textContent = playing ? 'stop' : 'play';
      });
      play.blur();
    });
    row.append(element('span', 'sp-layer', name), select, rpmInput, play);
    const entry = soundEntryFor(host.manifest, choice.layers[name]);
    const note = element('div', 'sp-note', `${entry.note} — freesound ${entry.sourceId} ${entry.sourceStart}-${entry.sourceEnd}s, ${entry.licence}`);
    return [row, note];
  }

  function render(): void {
    panel.replaceChildren();
    panel.appendChild(element('div', 'sp-title', `Sound picker — ${CAR_LABELS[shownCar]}  (M to close)`));
    const cars = element('div', 'sp-cars');
    for (const carId of CAR_IDS) {
      const button = element('button', `sp-car${carId === shownCar ? ' is-selected' : ''}`, CAR_LABELS[carId]);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(carId === shownCar));
      button.addEventListener('click', () => {
        host.stopPreview();
        shownCar = carId;
        render();
      });
      cars.appendChild(button);
    }
    panel.appendChild(cars);
    for (const name of LAYER_NAMES) panel.append(...layerRow(name));

    const volumeRow = element('label', 'sp-volume', 'volume');
    const volume = element('input', '');
    volume.type = 'range';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.01';
    volume.value = String(host.settings.volume);
    volume.addEventListener('input', () => {
      host.settings.volume = Number(volume.value);
      host.setVolume(host.settings.volume);
      host.save();
    });
    volume.addEventListener('change', () => volume.blur());
    volumeRow.appendChild(volume);
    panel.appendChild(volumeRow);

    const actions = element('div', 'sp-actions');
    const copy = element('button', '', 'copy choice');
    copy.type = 'button';
    const reset = element('button', '', 'defaults');
    reset.type = 'button';
    const status = element('span', 'sp-status');
    const output = element('textarea', '');
    output.readOnly = true;
    output.rows = 3;
    output.value = choiceSummaryJson(host.manifest, host.settings, shownCar);
    copy.addEventListener('click', () => {
      output.value = choiceSummaryJson(host.manifest, host.settings, shownCar);
      navigator.clipboard.writeText(output.value).then(() => {
        status.textContent = 'copied — paste it to us';
      }, (error: unknown) => {
        output.select();
        status.textContent = `clipboard refused (${error instanceof Error ? error.message : String(error)}) — copy the text below`;
      });
      copy.blur();
    });
    reset.addEventListener('click', () => {
      host.resetToDefaults(shownCar);
      reset.blur();
      render();
    });
    actions.append(copy, reset, status);
    panel.append(actions, output);
  }

  const picker: SoundPicker = {
    isOpen: () => !panel.hidden,
    shownCar: () => shownCar,
    toggle() {
      panel.hidden = !panel.hidden;
      if (panel.hidden) {
        host.stopPreview();
        return;
      }
      shownCar = host.currentCar();
      render();
    },
  };

  window.addEventListener('keydown', (event) => {
    if (event.code !== TOGGLE_KEY || event.repeat || isTextField(event.target)) return;
    picker.toggle();
  });
  return picker;
}
