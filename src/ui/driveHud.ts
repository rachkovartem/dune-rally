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

/** X steps through the modes in the order of the real selector, and after the last one starts over. */
export function nextDriveModeInCycle(mode: DriveMode): DriveMode {
  return DRIVE_MODES[(DRIVE_MODES.indexOf(mode) + 1) % DRIVE_MODES.length];
}

export interface DriveHudView {
  /** The engaged mode, with the asked-for one after an arrow while the car refuses it; null for a fixed drive. */
  mode: string | null;
  /** Why the asked-for mode is not engaged; null when nothing is refused. */
  warning: string | null;
  /** «ТК выкл» while traction control is off; null while it is on. */
  traction: string | null;
}

export function driveHudView(state: DriveState): DriveHudView {
  const traction = state.tractionControl ? null : TRACTION_OFF_LABEL;
  const drive = state.drive;
  if (drive.kind === 'fixed') return { mode: null, warning: null, traction };
  const mode = drive.requested === drive.mode ? drive.mode : `${drive.mode} → ${drive.requested}`;
  return { mode, warning: drive.blocked === null ? null : BLOCK_LABELS[drive.blocked], traction };
}

export interface KeyHint {
  key: string;
  label: string;
}

/** The HUD hint for the drive keys: X only for a car whose drive can be changed. */
export function driveKeyHints(drive: DriveModeState): KeyHint[] {
  const traction: KeyHint = { key: 'T', label: 'ТК' };
  return drive.kind === 'selectable' ? [traction, { key: 'X', label: 'привод' }] : [traction];
}

export interface DriveHud {
  update(state: DriveState): void;
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
    update(state) {
      const view = driveHudView(state);
      show(parts.mode, view.mode);
      show(parts.warning, view.warning);
      show(parts.traction, view.traction);
      const empty = view.mode === null && view.warning === null && view.traction === null;
      if (element.hidden !== empty) element.hidden = empty;
    },
  };
}
