// src/ui/driveHud.ts
// The drive mode and traction control in the HUD, and the key hints that go with them.
import { DRIVE_MODES, type DriveMode, type DriveModeBlock } from '../../shared/driveModes';
import type { DriveModeState, DriveState } from '../../shared/vehiclePhysics';

export const TRACTION_OFF_LABEL = 'ТК выкл';
export const TRACTION_ON_LABEL = 'ТК вкл';

/** Said once when the driver presses X in a car whose drive cannot be changed. */
export const FIXED_DRIVE_LABELS: Readonly<Record<'awd' | 'fwd', string>> = {
  awd: 'полный привод (постоянный)',
  fwd: 'передний привод',
};

const BLOCK_LABELS: Readonly<Record<NonNullable<DriveModeBlock>, string>> = {
  rangeChangeTooFast: 'сбросьте скорость',
};

const SELECTABLE_MODE_LABELS: Record<DriveMode, string> = {
  '2H': '2H (Задний)',
  '4H': '4H (Полный 4x4)',
  '4HLc': '4HLc (Блокировка)',
  '4LLc': '4LLc (Пониженная 4x4)',
};

/** X steps through the modes in the order of the real selector, and after the last one starts over. */
export function nextDriveModeInCycle(mode: DriveMode): DriveMode {
  return DRIVE_MODES[(DRIVE_MODES.indexOf(mode) + 1) % DRIVE_MODES.length];
}

export interface DriveHudView {
  /** The engaged mode, with the asked-for one after an arrow while the car refuses it; null for a fixed drive. */
  mode: string | null;
  /** Why the asked-for mode is not engaged or sinkage warning; null when nothing is refused. */
  warning: string | null;
  /** «ТК выкл» while traction control is off; null while it is on. */
  traction: string | null;
}

export function driveHudView(state: DriveState, maxSink = 0): DriveHudView {
  const traction = state.tractionControl ? null : TRACTION_OFF_LABEL;
  const drive = state.drive;
  let mode: string;
  let warning: string | null = null;

  if (drive.kind === 'fixed') {
    mode = drive.layout === 'awd' ? 'AWD (Полный 4x4)' : 'FWD (Передний привод)';
  } else {
    const cur = SELECTABLE_MODE_LABELS[drive.mode] ?? drive.mode;
    const req = SELECTABLE_MODE_LABELS[drive.requested] ?? drive.requested;
    mode = drive.requested === drive.mode ? cur : `${cur} → ${req}`;
    if (drive.blocked !== null) {
      warning = BLOCK_LABELS[drive.blocked];
    }
  }

  if (warning === null && maxSink > 0.07) {
    warning = maxSink > 0.13 ? '⚠️ Закопался в песке!' : '⚠️ Вязнет в песке!';
  }

  return { mode, warning, traction };
}

export interface KeyHint {
  key: string;
  label: string;
}

/** The HUD hint for the drive keys: X only for a car whose drive can be changed. */
export function driveKeyHints(drive: DriveModeState): KeyHint[] {
  const traction: KeyHint = { key: 'T', label: 'антибукс (TCS)' };
  return drive.kind === 'selectable' ? [traction, { key: 'X', label: 'привод (2H/4H/4L)' }] : [traction];
}

export interface DriveHud {
  update(state: DriveState, maxSink?: number): void;
}

/** Writes the view into the element's `.drive-mode`, `.drive-warning` and `.drive-traction` parts, only when it changes. */
export function createDriveHud(element: HTMLElement): DriveHud {
  const part = (className: string): HTMLElement => {
    const found = element.querySelector<HTMLElement>(`.${className}`);
    if (!found) throw new Error(`Expected a .${className} element in the drive HUD.`);
    return found;
  };
  const parts = { mode: part('drive-mode'), warning: part('drive-warning'), traction: part('drive-traction') };
  const show = (target: HTMLElement, text: string | null): void => {
    const hidden = text === null;
    if (target.hidden !== hidden) target.hidden = hidden;
    if (text !== null && target.textContent !== text) target.textContent = text;
  };
  return {
    update(state, maxSink) {
      const view = driveHudView(state, maxSink);
      show(parts.mode, view.mode);
      show(parts.warning, view.warning);
      show(parts.traction, view.traction);
      const empty = view.mode === null && view.warning === null && view.traction === null;
      if (element.hidden !== empty) element.hidden = empty;
    },
  };
}
