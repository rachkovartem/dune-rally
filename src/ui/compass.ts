// src/ui/compass.ts
// The HUD compass: a horizontal strip of letters and ticks that slides under a fixed centre mark,
// plus the heading in degrees. It follows the camera, because the camera is what the player looks through.

const FULL_TURN = 360;
const LABEL_STEP_DEGREES = 45;
const TICK_STEP_DEGREES = 15;
const LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Heading of a horizontal direction: 0 = north (−z), 90 = east (+x), always in [0, 360). */
export function compassHeadingDegrees(forwardX: number, forwardZ: number): number {
  if (forwardX === 0 && forwardZ === 0) {
    throw new Error('compassHeadingDegrees: a zero direction has no heading.');
  }
  const degrees = (Math.atan2(forwardX, -forwardZ) * 180) / Math.PI;
  const wrapped = ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
  // -0.0000001 wraps to 360 in floating point; the range promise is [0, 360).
  return wrapped >= FULL_TURN ? 0 : wrapped;
}

/** The letter at a whole multiple of 45° ('N', 'NE', …); null for every other heading. */
export function compassLabelAt(degrees: number): string | null {
  const wrapped = ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN;
  if (wrapped % LABEL_STEP_DEGREES !== 0) return null;
  return LABELS[wrapped / LABEL_STEP_DEGREES];
}

/** Degrees of the world the strip shows, centred on the heading. */
const VISIBLE_DEGREES = 120;
const PIXELS_PER_DEGREE = 3;
// A tick is placed from one turn before north to one turn after, so the visible window never runs off the strip.
const STRIP_START_DEGREES = -FULL_TURN;
const STRIP_END_DEGREES = 2 * FULL_TURN;
// Redrawing for a smaller change than this moves the strip by under a third of a pixel.
const REDRAW_DEGREES = 0.1;

export interface Compass {
  /** Points the strip at the heading of a horizontal direction; a vertical view keeps the last heading. */
  update(forwardX: number, forwardZ: number): void;
}

export function createCompass(container: HTMLElement): Compass {
  const view = document.createElement('div');
  view.className = 'compass-window';
  view.style.width = `${VISIBLE_DEGREES * PIXELS_PER_DEGREE}px`;
  const strip = document.createElement('div');
  strip.className = 'compass-strip';
  for (let degrees = STRIP_START_DEGREES; degrees <= STRIP_END_DEGREES; degrees += TICK_STEP_DEGREES) {
    const label = compassLabelAt(degrees);
    const mark = document.createElement('div');
    mark.className = label === null ? 'compass-tick' : 'compass-tick compass-tick-label';
    mark.style.left = `${(degrees - STRIP_START_DEGREES) * PIXELS_PER_DEGREE}px`;
    if (label !== null) mark.textContent = label;
    strip.append(mark);
  }
  const centre = document.createElement('div');
  centre.className = 'compass-centre';
  view.append(strip, centre);
  const readout = document.createElement('div');
  readout.className = 'compass-degrees';
  container.append(view, readout);

  let shownDegrees: number | null = null;
  return {
    update(forwardX: number, forwardZ: number): void {
      // A camera looking straight down has no horizontal heading; the strip keeps the last one.
      if (Math.hypot(forwardX, forwardZ) < 1e-6) return;
      const degrees = compassHeadingDegrees(forwardX, forwardZ);
      if (shownDegrees !== null && Math.abs(degrees - shownDegrees) < REDRAW_DEGREES) return;
      shownDegrees = degrees;
      const offset = (degrees - STRIP_START_DEGREES - VISIBLE_DEGREES / 2) * PIXELS_PER_DEGREE;
      strip.style.transform = `translateX(${-offset}px)`;
      readout.textContent = `${Math.round(degrees) % FULL_TURN}°`;
    },
  };
}
