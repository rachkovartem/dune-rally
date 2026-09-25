// src/input/keyboard.test.ts
// Category 3 (the browser input a HUD and the car read): held keys against the page losing focus
// (release review). Vitest runs in Node with no DOM, so window and document are plain EventTargets.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keyboard } from './keyboard';
import { controlsFromKeys } from './controls';

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
}

/** The two fields of a KeyboardEvent the keyboard reads: its type and its physical key. */
class KeyEvent extends Event {
  constructor(type: 'keydown' | 'keyup', readonly code: string) {
    super(type);
  }
}

let fakeWindow: EventTarget;
let fakeDocument: FakeDocument;
let keyboard: Keyboard;

function press(code: string): void {
  fakeWindow.dispatchEvent(new KeyEvent('keydown', code));
}

function setVisibility(state: DocumentVisibilityState): void {
  fakeDocument.visibilityState = state;
  fakeDocument.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  fakeWindow = new EventTarget();
  fakeDocument = new FakeDocument();
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('document', fakeDocument);
  keyboard = new Keyboard();
});

afterEach(() => {
  keyboard.dispose();
  vi.unstubAllGlobals();
});

describe('Keyboard — a key held while the page loses focus', () => {
  it('drives while W is held', () => {
    press('KeyW');
    expect(controlsFromKeys(keyboard.keys).throttle).toBe(1);
  });

  it.each(['blur', 'pagehide'])('lets go of every held key on window %s', (type) => {
    press('KeyW');
    press('KeyA');
    fakeWindow.dispatchEvent(new Event(type));
    expect(controlsFromKeys(keyboard.keys)).toEqual({ throttle: 0, brake: 0, steer: 0 });
    expect(keyboard.keys.size).toBe(0);
  });

  it('lets go of every held key when the tab becomes hidden', () => {
    press('KeyW');
    setVisibility('hidden');
    expect(keyboard.keys.size).toBe(0);
  });

  it('keeps the held keys when the tab becomes visible', () => {
    press('KeyW');
    setVisibility('visible');
    expect(controlsFromKeys(keyboard.keys).throttle).toBe(1);
  });

  it('tracks a new key press after the keys were let go', () => {
    press('KeyW');
    keyboard.releaseAll();
    press('ArrowLeft');
    expect(controlsFromKeys(keyboard.keys)).toEqual({ throttle: 0, brake: 0, steer: -1 });
  });

  it('tracks a new key press after a blur', () => {
    press('KeyW');
    fakeWindow.dispatchEvent(new Event('blur'));
    press('KeyS');
    expect(controlsFromKeys(keyboard.keys)).toEqual({ throttle: 0, brake: 1, steer: 0 });
  });
});

describe('Keyboard — after dispose', () => {
  it('no longer reacts to blur, pagehide or a hidden tab', () => {
    press('KeyW');
    keyboard.dispose();
    fakeWindow.dispatchEvent(new Event('blur'));
    fakeWindow.dispatchEvent(new Event('pagehide'));
    setVisibility('hidden');
    expect(controlsFromKeys(keyboard.keys).throttle).toBe(1);
  });

  it('no longer tracks key presses', () => {
    keyboard.dispose();
    press('KeyW');
    expect(keyboard.keys.size).toBe(0);
  });
});
