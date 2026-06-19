// src/input/keyboard.ts
export class Keyboard {
  readonly keys = new Set<string>();
  private onDown = (e: KeyboardEvent) => this.keys.add(e.key.toLowerCase());
  private onUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }
  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }
}
