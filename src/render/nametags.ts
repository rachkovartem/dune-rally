// src/render/nametags.ts
import * as THREE from 'three';

export interface NametagOptions {
  name: string;
  isDuelOpponent?: boolean;
}

/** Draws crisp nametag onto an offscreen canvas and returns a texture. */
function renderNametagCanvas(canvas: HTMLCanvasElement, options: NametagOptions): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const radius = 14;
  const paddingX = 14;
  const text = options.name || 'Гонщик';

  ctx.font = 'bold 22px "Trebuchet MS", "Segoe UI", system-ui, sans-serif';
  const textWidth = ctx.measureText(text).width;
  const totalWidth = Math.min(w - 8, Math.max(80, textWidth + paddingX * 2));
  const totalHeight = 40;
  const x = (w - totalWidth) / 2;
  const y = (h - totalHeight) / 2;

  // Background pill
  ctx.beginPath();
  ctx.roundRect(x, y, totalWidth, totalHeight, radius);
  ctx.fillStyle = options.isDuelOpponent ? 'rgba(40, 15, 5, 0.88)' : 'rgba(15, 10, 6, 0.78)';
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = options.isDuelOpponent ? '#ff4d4d' : 'rgba(255, 210, 61, 0.65)';
  ctx.stroke();

  // Text
  ctx.fillStyle = options.isDuelOpponent ? '#ffb3b3' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.fillText(text, w / 2, h / 2 + 1);
}

export class NametagSprite {
  readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly texture: THREE.CanvasTexture | null = null;
  private currentName = '';
  private currentOpponent = false;

  constructor(options: NametagOptions) {
    if (typeof document !== 'undefined') {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 256;
      this.canvas.height = 64;

      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.generateMipmaps = false;

      const material = new THREE.SpriteMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
      });

      this.sprite = new THREE.Sprite(material);
    } else {
      this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
    }

    this.sprite.scale.set(3.2, 0.8, 1);
    this.sprite.position.set(0, 2.0, 0);

    this.update(options);
  }

  update(options: NametagOptions): void {
    if (this.currentName === options.name && this.currentOpponent === options.isDuelOpponent) return;
    this.currentName = options.name;
    this.currentOpponent = !!options.isDuelOpponent;

    if (this.canvas && this.texture) {
      renderNametagCanvas(this.canvas, options);
      this.texture.needsUpdate = true;
    }
  }

  /** Update distance-based visibility and fade relative to camera. */
  updateDistance(distanceToCamera: number): void {
    const FADE_START = 40;
    const FADE_END = 95;

    if (distanceToCamera > FADE_END) {
      this.sprite.visible = false;
      return;
    }

    this.sprite.visible = true;
    if (distanceToCamera <= FADE_START) {
      this.sprite.material.opacity = 1.0;
    } else {
      this.sprite.material.opacity = 1.0 - (distanceToCamera - FADE_START) / (FADE_END - FADE_START);
    }
  }

  dispose(): void {
    this.texture?.dispose();
    this.sprite.material.dispose();
  }
}
