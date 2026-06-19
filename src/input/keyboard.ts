// src/input/keyboard.ts

/**
 * Tracks held keys by PHYSICAL key (event.code), normalised to layout-independent tokens:
 *   KeyW -> "w", KeyA -> "a", ArrowUp -> "arrowup", etc.
 * Using event.code (not event.key) makes WASD work on non-Latin layouts (e.g. Cyrillic),
 * where event.key for the physical W key would be "ц" and never match "w".
 */
export class Keyboard {
  readonly keys = new Set<string>();

  private token(e: KeyboardEvent): string {
    const c = e.code;
    if (c.startsWith('Key')) return c.slice(3).toLowerCase(); // KeyW -> "w"
    if (c.startsWith('Arrow')) return c.toLowerCase();        // ArrowUp -> "arrowup"
    return c.toLowerCase();
  }

  private onDown = (e: KeyboardEvent) => this.keys.add(this.token(e));
  private onUp = (e: KeyboardEvent) => this.keys.delete(this.token(e));

  constructor() {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  dispose() {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
  }
}
