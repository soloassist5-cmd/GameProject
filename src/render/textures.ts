import { Texture } from 'pixi.js';

function canvasTexture(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx, size);
  return Texture.from(canvas);
}

/** Soft round glow with a hot core — the single building block of the whole look. */
export function createGlowTexture(size = 64): Texture {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** Dark edges, clear centre. Stretched over the screen. */
export function createVignetteTexture(size = 512): Texture {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.22, s / 2, s / 2, s * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}
