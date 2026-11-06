import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

/**
 * Every surface and artwork in the room is painted here in code — no image
 * downloads, so the classroom loads fast on school Wi-Fi and phones.
 */

type Ctx = CanvasRenderingContext2D;

function make(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: false })!];
}

function tex(c: HTMLCanvasElement, repeat?: [number, number]): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 16; // sharper at a slant (the renderer caps it to what the GPU supports)
  if (repeat) {
    t.wrapS = t.wrapT = RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

/**
 * Painting a texture is slow (thousands of brush strokes), so each one is painted
 * once per page and reused: the join screen's room and the classroom share them.
 * Callers get their own copy (sharing the painted canvas) so disposing a scene
 * never breaks another.
 */
const painted = new Map<string, Texture>();
export function reuse<A extends unknown[]>(name: string, paint: (...a: A) => Texture, ...args: A): Texture {
  const key = `${name}:${JSON.stringify(args)}`;
  let t = painted.get(key);
  if (!t) {
    t = paint(...args);
    painted.set(key, t);
  }
  const copy = t.clone();
  copy.needsUpdate = true;
  return copy;
}
export function isPainted(name: string, ...args: unknown[]) {
  return painted.has(`${name}:${JSON.stringify(args)}`);
}

/** Seeded random so every screen paints the same room. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function grain(ctx: Ctx, w: number, h: number, strength: number, seed = 7) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * strength;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function plaster(base = '#e7dcc9'): Texture {
  const [c, ctx] = make(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(3);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512, y = r() * 512, rad = 30 + r() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    const light = r() > 0.5;
    g.addColorStop(0, light ? 'rgba(255,250,240,0.10)' : 'rgba(150,120,90,0.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  grain(ctx, 512, 512, 10);
  return tex(c, [4, 2]);
}

/** Oak floor planks: one tile = 2 m × 2 m. */
export function floorPlanks(): Texture {
  const W = 1024;
  const [c, ctx] = make(W, W);
  const r = rng(11);
  const rows = 10;
  const rowH = W / rows;
  const tones = ['#a77b52', '#9b6f48', '#b38659', '#8f6643', '#a8784d', '#b08158'];
  for (let row = 0; row < rows; row++) {
    let x = -r() * 400;
    while (x < W) {
      const len = 260 + r() * 360;
      const tone = tones[Math.floor(r() * tones.length)];
      ctx.fillStyle = tone;
      ctx.fillRect(x, row * rowH, len, rowH);
      // grain
      ctx.strokeStyle = 'rgba(60,35,15,0.18)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 7; g++) {
        const gy = row * rowH + 6 + r() * (rowH - 12);
        ctx.beginPath();
        ctx.moveTo(x, gy);
        for (let gx = x; gx < x + len; gx += 24) ctx.lineTo(gx, gy + Math.sin(gx / (40 + g * 9)) * 2.2);
        ctx.stroke();
      }
      // plank edges
      ctx.fillStyle = 'rgba(40,24,10,0.55)';
      ctx.fillRect(x, row * rowH, 2, rowH);
      ctx.fillRect(x, row * rowH, len, 1.5);
      x += len;
    }
  }
  grain(ctx, W, W, 14);
  return tex(c, [7, 8]);
}

/** Vertical-grain oak for panelling and furniture. */
export function oak(base = '#7c5a3c', repeat: [number, number] = [1, 1]): Texture {
  const [c, ctx] = make(512, 512);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  const r = rng(5);
  for (let i = 0; i < 160; i++) {
    const x = r() * 512;
    ctx.strokeStyle = `rgba(${r() > 0.5 ? '255,230,200' : '40,22,8'},${0.04 + r() * 0.08})`;
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) ctx.lineTo(x + Math.sin(y / 70 + i) * 4, y);
    ctx.stroke();
  }
  grain(ctx, 512, 512, 10, 9);
  return tex(c, repeat);
}

/** Bright sky seen through the windows. */
export function windowSky(): Texture {
  const [c, ctx] = make(256, 512);
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#cfe3f2');
  g.addColorStop(0.55, '#eef4f4');
  g.addColorStop(0.8, '#e9efe2');
  g.addColorStop(1, '#b9c9a8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 512);
  // distant trees
  const r = rng(21);
  ctx.fillStyle = 'rgba(110,140,100,0.55)';
  for (let i = 0; i < 26; i++) {
    const x = r() * 256, rad = 14 + r() * 26;
    ctx.beginPath();
    ctx.arc(x, 430 + r() * 30, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return tex(c);
}

/* ------------------------------------------------------------------ */
/* Board                                                               */
/* ------------------------------------------------------------------ */

/** Slate-glass board background, drawn under the ink each frame. */
export function slateBackground(w: number, h: number): HTMLCanvasElement {
  const [c, ctx] = make(w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#24352f');
  g.addColorStop(0.55, '#1d2b27');
  g.addColorStop(1, '#17231f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const glow = ctx.createRadialGradient(w / 2, 0, 0, w / 2, 0, w * 0.6);
  glow.addColorStop(0, 'rgba(255,255,255,0.05)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  // faint chalk dust
  const r = rng(13);
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = `rgba(240,240,230,${r() * 0.035})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
}

/** The board as it appears behind the sign-in card. */
export function welcomeBoard(w: number, h: number): HTMLCanvasElement {
  const c = slateBackground(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(244,241,234,0.92)';
  ctx.textAlign = 'center';
  ctx.font = `italic 400 ${Math.round(h * 0.13)}px Fraunces, Georgia, serif`;
  ctx.fillText('Welcome to class', w / 2, h * 0.42);
  ctx.strokeStyle = 'rgba(242,180,76,0.85)';
  ctx.lineWidth = h * 0.008;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(w * 0.3, h * 0.5);
  ctx.quadraticCurveTo(w * 0.5, h * 0.53, w * 0.7, h * 0.49);
  ctx.stroke();
  ctx.font = `400 ${Math.round(h * 0.05)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(244,241,234,0.6)';
  ctx.fillText('Meeto360', w / 2, h * 0.64);
  return c;
}

/* ------------------------------------------------------------------ */
/* Paintings — oil-style, with brush texture                           */
/* ------------------------------------------------------------------ */

/** Lay short brush strokes over a painted canvas, sampling its own colours. */
function brushwork(ctx: Ctx, w: number, h: number, strokes: number, size: number, seed: number) {
  const r = rng(seed);
  const src = ctx.getImageData(0, 0, w, h).data;
  for (let i = 0; i < strokes; i++) {
    const x = r() * w, y = r() * h;
    const p = (Math.floor(y) * w + Math.floor(x)) * 4;
    const j = (r() - 0.5) * 26;
    ctx.fillStyle = `rgba(${src[p] + j},${src[p + 1] + j},${src[p + 2] + j},0.42)`;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((r() - 0.5) * 0.9);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * (0.6 + r()), size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function ridge(ctx: Ctx, w: number, base: number, amp: number, seed: number, color: string, h: number) {
  const r = rng(seed);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, h);
  let y = base;
  for (let x = 0; x <= w; x += 8) {
    y += (r() - 0.5) * amp * 0.35 + (base - y) * 0.04;
    ctx.lineTo(x, y + Math.sin(x / (w / 3) + seed) * amp);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

/** Mountain lake at golden hour. */
export function paintingLandscape(): Texture {
  const W = 900, H = 600;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  sky.addColorStop(0, '#7f9bb5');
  sky.addColorStop(0.5, '#e5b98a');
  sky.addColorStop(1, '#f3d7a4');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.68, H * 0.42, 0, W * 0.68, H * 0.42, 160);
  sun.addColorStop(0, 'rgba(255,240,200,0.95)');
  sun.addColorStop(0.25, 'rgba(255,220,160,0.6)');
  sun.addColorStop(1, 'rgba(255,200,140,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
  ridge(ctx, W, H * 0.44, 40, 2, '#9fa7b5', H);
  ridge(ctx, W, H * 0.5, 34, 5, '#7c8a90', H);
  ridge(ctx, W, H * 0.57, 26, 9, '#556a5c', H);
  // lake
  const lake = ctx.createLinearGradient(0, H * 0.64, 0, H * 0.8);
  lake.addColorStop(0, '#d9b98f');
  lake.addColorStop(1, '#6f8c95');
  ctx.fillStyle = lake;
  ctx.fillRect(0, H * 0.64, W, H * 0.16);
  ridge(ctx, W, H * 0.8, 18, 14, '#3e5241', H);
  ridge(ctx, W, H * 0.9, 12, 17, '#2d3b2f', H);
  brushwork(ctx, W, H, 9000, 9, 31);
  return tex(c);
}

/** Calm sea with a sailboat at dusk. */
export function paintingSea(): Texture {
  const W = 1000, H = 600;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, '#4e6283');
  sky.addColorStop(0.6, '#c99a8c');
  sky.addColorStop(1, '#efc79a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.55);
  const sea = ctx.createLinearGradient(0, H * 0.55, 0, H);
  sea.addColorStop(0, '#8d8fa0');
  sea.addColorStop(1, '#2c3d55');
  ctx.fillStyle = sea;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);
  const r = rng(41);
  for (let i = 0; i < 260; i++) {
    const y = H * 0.56 + Math.pow(r(), 1.6) * H * 0.44;
    ctx.strokeStyle = `rgba(${r() > 0.6 ? '245,215,170' : '200,210,225'},${0.15 + r() * 0.25})`;
    ctx.lineWidth = 1 + (y / H) * 3;
    const x = r() * W, len = 20 + (y / H) * 90;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + len, y + (r() - 0.5) * 3);
    ctx.stroke();
  }
  // sailboat
  ctx.fillStyle = '#2b2622';
  ctx.beginPath();
  ctx.moveTo(610, 372);
  ctx.lineTo(700, 372);
  ctx.lineTo(688, 386);
  ctx.lineTo(620, 386);
  ctx.fill();
  ctx.fillStyle = '#f2e6d2';
  ctx.beginPath();
  ctx.moveTo(652, 250);
  ctx.lineTo(652, 368);
  ctx.lineTo(600, 368);
  ctx.fill();
  ctx.fillStyle = '#e9d7bd';
  ctx.beginPath();
  ctx.moveTo(656, 262);
  ctx.lineTo(656, 368);
  ctx.lineTo(698, 368);
  ctx.fill();
  brushwork(ctx, W, H, 9000, 10, 43);
  return tex(c);
}

/** A modernist composition — circles and arcs in warm, muted colour. */
export function paintingAbstract(): Texture {
  const W = 600, H = 760;
  const [c, ctx] = make(W, H);
  ctx.fillStyle = '#efe6d6';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d9cbb3';
  ctx.fillRect(0, H * 0.62, W, H * 0.38);
  const disc = (x: number, y: number, rad: number, col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  };
  disc(W * 0.62, H * 0.3, 150, '#c4673f');
  disc(W * 0.3, H * 0.52, 95, '#264b6b');
  disc(W * 0.7, H * 0.66, 58, '#e0a43c');
  ctx.strokeStyle = '#1f1b17';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(W * 0.45, H * 0.62, 190, Math.PI * 1.05, Math.PI * 1.75);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W * 0.1, H * 0.84);
  ctx.lineTo(W * 0.9, H * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#1f1b17';
  ctx.fillRect(W * 0.16, H * 0.14, 10, 150);
  brushwork(ctx, W, H, 6000, 8, 51);
  return tex(c);
}

/** A night sky over hills, with the Milky Way. */
export function paintingNight(): Texture {
  const W = 800, H = 1000;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#0d1630');
  sky.addColorStop(0.55, '#1f2d55');
  sky.addColorStop(0.8, '#4a4a6e');
  sky.addColorStop(1, '#2a2638');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const r = rng(61);
  // the Milky Way band
  ctx.save();
  ctx.translate(W * 0.5, H * 0.45);
  ctx.rotate(-0.55);
  for (let i = 0; i < 2600; i++) {
    const x = (r() - 0.5) * W * 1.6;
    const y = (r() + r() + r() - 1.5) * 70;
    ctx.fillStyle = `rgba(${220 + r() * 35},${210 + r() * 40},${255},${r() * 0.5})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  const band = ctx.createLinearGradient(0, -110, 0, 110);
  band.addColorStop(0, 'rgba(180,170,230,0)');
  band.addColorStop(0.5, 'rgba(210,190,240,0.18)');
  band.addColorStop(1, 'rgba(180,170,230,0)');
  ctx.fillStyle = band;
  ctx.fillRect(-W, -110, W * 2, 220);
  ctx.restore();
  for (let i = 0; i < 700; i++) {
    const b = r();
    ctx.fillStyle = `rgba(255,250,235,${0.3 + b * 0.7})`;
    ctx.beginPath();
    ctx.arc(r() * W, r() * H * 0.78, b * 1.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ridge(ctx, W, H * 0.8, 30, 4, '#1b1a26', H);
  ridge(ctx, W, H * 0.88, 18, 8, '#100f17', H);
  brushwork(ctx, W, H, 5000, 7, 63);
  return tex(c);
}

/** Saturn rising over a pale desert — a calm, imagined planetscape. */
export function paintingPlanet(): Texture {
  const W = 900, H = 640;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2b3557');
  sky.addColorStop(0.6, '#c78f6b');
  sky.addColorStop(1, '#e8c39a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // planet with rings
  const px = W * 0.66, py = H * 0.38;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(-0.35);
  ctx.strokeStyle = 'rgba(240,215,170,0.75)';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.ellipse(0, 0, 190, 46, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  const pg = ctx.createRadialGradient(-30, -30, 10, 0, 0, 110);
  pg.addColorStop(0, '#f4ddb0');
  pg.addColorStop(1, '#b4825a');
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(0, 0, 105, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 0, 190, 46, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();
  ridge(ctx, W, H * 0.7, 22, 21, '#c9a07a', H);
  ridge(ctx, W, H * 0.8, 14, 25, '#a8805c', H);
  brushwork(ctx, W, H, 8000, 9, 67);
  return tex(c);
}

/** Hot-air balloons drifting over green hills — bright and cheerful. */
export function paintingBalloons(): Texture {
  const W = 800, H = 1000;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2f8fd8');
  sky.addColorStop(0.6, '#8fd0f5');
  sky.addColorStop(1, '#fff1c9');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const r = rng(71);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 6; i++) {
    const x = r() * W, y = 80 + r() * 420;
    for (let k = 0; k < 5; k++) {
      ctx.beginPath();
      ctx.arc(x + k * 34 - 60, y + Math.sin(k) * 12, 30 + r() * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ridge(ctx, W, H * 0.78, 40, 72, '#7cc35b', H);
  ridge(ctx, W, H * 0.86, 30, 73, '#4fa043', H);
  ridge(ctx, W, H * 0.93, 20, 74, '#2f7a38', H);
  const balloon = (x: number, y: number, s: number, cols: string[]) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const n = cols.length * 2;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath();
      const a0 = -Math.PI / 2 - Math.PI / 2 + (i / n) * Math.PI * 2 * 0.5;
      ctx.moveTo(0, 120);
      ctx.ellipse(0, 0, 100 * Math.abs(Math.cos(a0)) + 1, 110, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // stripes as vertical segments
    for (let i = 0; i < n; i++) {
      const x0 = -100 + (i * 200) / n, x1 = -100 + ((i + 1) * 200) / n;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 0, 100, 110, 0, 0, Math.PI * 2);
      ctx.moveTo(-60, 85);
      ctx.lineTo(0, 150);
      ctx.lineTo(60, 85);
      ctx.clip();
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(x0, -120, x1 - x0 + 1, 280);
      ctx.restore();
    }
    ctx.strokeStyle = '#5a4030';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-30, 140);
    ctx.lineTo(-18, 185);
    ctx.moveTo(30, 140);
    ctx.lineTo(18, 185);
    ctx.stroke();
    ctx.fillStyle = '#8b5a2b';
    ctx.fillRect(-22, 185, 44, 30);
    ctx.restore();
  };
  balloon(W * 0.32, H * 0.36, 1.25, ['#e63946', '#ffd166', '#f77f00']);
  balloon(W * 0.74, H * 0.22, 0.8, ['#7b2cbf', '#4cc9f0', '#f72585']);
  balloon(W * 0.68, H * 0.58, 0.55, ['#06d6a0', '#ffd166', '#118ab2']);
  balloon(W * 0.16, H * 0.66, 0.4, ['#ff006e', '#fb5607', '#ffbe0b']);
  brushwork(ctx, W, H, 7000, 8, 75);
  return tex(c);
}

/** A rainbow after rain, over a mountain lake with its reflection. */
export function paintingRainbow(): Texture {
  const W = 800, H = 1000;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#4f7fb8');
  sky.addColorStop(0.55, '#a9cfe9');
  sky.addColorStop(1, '#fde9c2');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  // the rainbow, centred low on the left
  const cx = W * 0.38, cy = H * 0.66;
  const bands = ['#e8343c', '#f6892b', '#f7d23a', '#3fbf5a', '#2f9be0', '#4a55c9', '#8a46c4'];
  ctx.globalAlpha = 0.85;
  bands.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 20;
    ctx.beginPath();
    ctx.arc(cx, cy, 470 - i * 20, Math.PI, Math.PI * 2);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ridge(ctx, W, H * 0.5, 60, 111, '#7d93a8', H);
  ridge(ctx, W, H * 0.57, 40, 112, '#4f7a5e', H);
  // the lake, with a soft mirror of the sky
  const lake = ctx.createLinearGradient(0, H * 0.64, 0, H);
  lake.addColorStop(0, '#9cc6df');
  lake.addColorStop(1, '#2f6f8f');
  ctx.fillStyle = lake;
  ctx.fillRect(0, H * 0.64, W, H * 0.36);
  ctx.globalAlpha = 0.3;
  bands.forEach((col, i) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(cx, H * 0.64, 470 - i * 20, 120 - i * 5, 0, 0, Math.PI);
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
  ridge(ctx, W, H * 0.9, 16, 113, '#2f5e38', H);
  brushwork(ctx, W, H, 9000, 8, 115);
  return tex(c);
}

/** Rows of tulips in bloom under a warm sky. */
export function paintingBlooms(): Texture {
  const W = 900, H = 640;
  const [c, ctx] = make(W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.45);
  sky.addColorStop(0, '#5bb6f0');
  sky.addColorStop(1, '#ffe7b3');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffd36b';
  ctx.beginPath();
  ctx.arc(W * 0.8, H * 0.15, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5c9e45';
  ctx.fillRect(0, H * 0.42, W, H * 0.58);
  const rows = ['#e5383b', '#ffba08', '#ff4d9d', '#9d4edd', '#f48c06', '#e5383b'];
  const r = rng(91);
  rows.forEach((col, i) => {
    const y0 = H * 0.45 + i * i * 9 + i * 18;
    const size = 5 + i * 3.2;
    for (let x = -10; x < W + 20; x += size * 2.1) {
      const y = y0 + (r() - 0.5) * size;
      ctx.strokeStyle = '#2e6b2b';
      ctx.lineWidth = Math.max(1, size * 0.25);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + size * 2.2);
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(x, y, size * 0.8, size, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  brushwork(ctx, W, H, 9000, 8, 93);
  return tex(c);
}

/** Bright planets on their orbits around a golden sun. */
export function paintingOrbits(): Texture {
  const W = 600, H = 760;
  const [c, ctx] = make(W, H);
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0f2a5c');
  bg.addColorStop(1, '#3a1a5e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const cx = W * 0.5, cy = H * 0.52;
  const sun = ctx.createRadialGradient(cx, cy, 6, cx, cy, 70);
  sun.addColorStop(0, '#fff6c2');
  sun.addColorStop(0.5, '#ffc93c');
  sun.addColorStop(1, 'rgba(255,140,40,0)');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(cx, cy, 70, 0, Math.PI * 2);
  ctx.fill();
  const planets: [number, number, number, string][] = [
    [80, 0.7, 10, '#ff6b6b'],
    [130, 2.4, 15, '#4cc9f0'],
    [185, 4.1, 13, '#ff9f1c'],
    [240, 5.6, 22, '#f72585'],
    [290, 1.5, 18, '#06d6a0'],
  ];
  for (const [rad, a, size, col] of planets) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rad, rad * 0.86, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 0.86, size, 0, Math.PI * 2);
    ctx.fill();
  }
  const r = rng(101);
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = `rgba(255,255,255,${r() * 0.8})`;
    ctx.fillRect(r() * W, r() * H, 2, 2);
  }
  brushwork(ctx, W, H, 5000, 7, 103);
  return tex(c);
}

/* ------------------------------------------------------------------ */
/* Quotes                                                              */
/* ------------------------------------------------------------------ */

/** Break text into lines that fit `width`. */
function wrap(ctx: Ctx, text: string, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > width && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * A framed quotation from a scientist, set large and dark on ivory so it can be
 * read from the back row.
 */
export function quotePlate(quote: string, author: string, note: string): Texture {
  const W = 1600, H = 1100;
  const [c, ctx] = paper(W, H);
  // a gold rule inside the edge
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 10;
  ctx.strokeRect(46, 46, W - 92, H - 92);
  ctx.fillStyle = GOLD;
  ctx.font = '700 300px Fraunces, Georgia, serif';
  ctx.textAlign = 'left';
  ctx.fillText('“', 92, 330);
  ctx.fillStyle = '#ffffff';
  let size = 150;
  let lines: string[] = [];
  for (; size >= 90; size -= 4) {
    ctx.font = `700 ${size}px Fraunces, Georgia, serif`;
    lines = wrap(ctx, quote, W - 330);
    if (lines.length * size * 1.16 < H - 430) break;
  }
  const top = 210 + size * 0.85;
  lines.forEach((l, i) => ctx.fillText(l, 190, top + i * size * 1.16));
  const y = top + (lines.length - 1) * size * 1.16 + 150;
  ctx.fillStyle = GOLD;
  ctx.font = '800 92px Inter, system-ui, sans-serif';
  ctx.fillText(`— ${author}`, 190, y);
  ctx.fillStyle = '#c9d6ee';
  ctx.font = '600 50px Inter, system-ui, sans-serif';
  ctx.fillText(note, 190, y + 76, W - 360);
  return tex(c);
}

/** Lettering painted across a wall. */
export function inscription(text: string, author: string): Texture {
  const W = 2400, H = 260;
  const [c, ctx] = make(W, H);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#132a52';
  ctx.textAlign = 'center';
  ctx.font = 'italic 800 124px Fraunces, Georgia, serif';
  ctx.fillText(text, W / 2, 130, W - 80);
  ctx.font = '700 46px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '12px';
  ctx.fillStyle = '#8a5f2c';
  ctx.fillText(author.toUpperCase(), W / 2, 215);
  ctx.letterSpacing = '0px';
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
/* Scientific plates — engraved line art on ivory                      */
/* ------------------------------------------------------------------ */

const INK = '#fff7e6';

/** Prints with writing: deep navy with light, bold lettering — readable from the back row. */
function paper(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const [c, ctx] = make(w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#173058');
  g.addColorStop(1, '#0d1a33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 5, 17);
  return [c, ctx];
}
const GOLD = '#f6c453';

function caption(ctx: Ctx, text: string, w: number, y: number) {
  ctx.fillStyle = GOLD;
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.font = '700 30px Inter, system-ui, sans-serif';
  ctx.letterSpacing = '5px';
  ctx.fillText(text, w / 2, y);
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

export function plateMaxwell(): Texture {
  const [c, ctx] = paper(480, 560);
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 3.3;
  ctx.beginPath();
  ctx.moveTo(80, 120);
  ctx.lineTo(400, 120);
  ctx.moveTo(80, 420);
  ctx.lineTo(400, 420);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = 'italic 700 50px Fraunces, Georgia, serif';
  ['∇ · E = ρ / ε₀', '∇ · B = 0', '∇ × E = − ∂B/∂t'].forEach((l, i) => ctx.fillText(l, 240, 190 + i * 66, 420));
  ctx.font = 'italic 700 38px Fraunces, Georgia, serif';
  ctx.fillText('∇ × B = μ₀J + μ₀ε₀ ∂E/∂t', 240, 388, 440);
  caption(ctx, 'MAXWELL · 1865', 480, 500);
  return tex(c);
}

export function plateEuler(): Texture {
  const [c, ctx] = paper(480, 560);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4.4;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(90, 230);
  ctx.lineTo(390, 230);
  ctx.moveTo(240, 80);
  ctx.lineTo(240, 380);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(240, 230, 120, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(240, 230);
  ctx.lineTo(325, 145);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(240, 230, 40, -Math.PI / 4, 0);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(325, 145, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.font = 'italic 600 58px Fraunces, Georgia, serif';
  ctx.fillText('e', 172, 452);
  ctx.font = 'italic 600 36px Fraunces, Georgia, serif';
  ctx.fillText('iπ', 210, 424);
  ctx.font = 'italic 600 58px Fraunces, Georgia, serif';
  ctx.fillText('+ 1 = 0', 312, 452);
  caption(ctx, 'EULER · 1748', 480, 520);
  return tex(c);
}

export function plateSpiral(): Texture {
  const [c, ctx] = paper(560, 420);
  ctx.save();
  ctx.translate(64, 50);
  ctx.scale(2.95, 2.95);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.32;
  ctx.strokeRect(0, 0, 144, 89);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 0.77;
  for (const [x, y, s] of [[0, 0, 89], [89, 0, 55], [110, 55, 34], [89, 68, 21], [89, 55, 13], [102, 55, 8], [105, 63, 5]]) ctx.strokeRect(x, y, s, s);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.98;
  ctx.beginPath();
  ctx.arc(89, 89, 89, Math.PI, Math.PI * 1.5);
  ctx.arc(89, 55, 55, Math.PI * 1.5, 0);
  ctx.arc(110, 55, 34, 0, Math.PI * 0.5);
  ctx.arc(110, 68, 21, Math.PI * 0.5, Math.PI);
  ctx.arc(102, 68, 13, Math.PI, Math.PI * 1.5);
  ctx.arc(102, 63, 8, Math.PI * 1.5, 0);
  ctx.stroke();
  ctx.restore();
  caption(ctx, 'φ = 1.618…', 560, 385);
  return tex(c);
}

export function plateLens(): Texture {
  const [c, ctx] = paper(560, 420);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4.4;
  ctx.setLineDash([8, 8]);
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  ctx.moveTo(40, 200);
  ctx.lineTo(520, 200);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.ellipse(280, 200, 20, 130, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6.6;
  ctx.beginPath();
  ctx.moveTo(120, 200);
  ctx.lineTo(120, 115);
  ctx.moveTo(108, 128);
  ctx.lineTo(120, 112);
  ctx.lineTo(132, 128);
  ctx.moveTo(440, 200);
  ctx.lineTo(440, 268);
  ctx.moveTo(428, 256);
  ctx.lineTo(440, 272);
  ctx.lineTo(452, 256);
  ctx.stroke();
  ctx.lineWidth = 3.52;
  ctx.beginPath();
  ctx.moveTo(120, 115);
  ctx.lineTo(280, 115);
  ctx.lineTo(470, 300);
  ctx.moveTo(120, 115);
  ctx.lineTo(470, 300);
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const x of [200, 360]) {
    ctx.beginPath();
    ctx.arc(x, 200, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = 'italic 600 34px Fraunces, Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('F', 200, 240);
  ctx.fillText('F′', 360, 180);
  caption(ctx, 'OPTICS · THIN LENS', 560, 385);
  return tex(c);
}

/* ------------------------------------------------------------------ */
/* Small things                                                        */
/* ------------------------------------------------------------------ */

/** A name label for a person in the room. */
export function nameTag(text: string, accent = false): { texture: Texture; aspect: number } {
  const H = 64;
  const [m, mctx] = make(10, 10);
  mctx.font = '600 30px Inter, system-ui, sans-serif';
  const tw = Math.min(520, mctx.measureText(text).width);
  void m;
  const W = Math.ceil(tw + 44 + (accent ? 34 : 0));
  const [c, ctx] = make(W, H);
  ctx.fillStyle = accent ? 'rgba(242,180,76,0.96)' : 'rgba(22,18,14,0.82)';
  const r = H / 2;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, r);
  ctx.fill();
  ctx.font = '600 30px Inter, system-ui, sans-serif';
  ctx.fillStyle = accent ? '#14110e' : '#f5efe4';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 22 + (accent ? 34 : 0), H / 2 + 1, 520);
  if (accent) {
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText('✋', 14, H / 2 + 2);
  }
  const t = tex(c);
  return { texture: t, aspect: W / H };
}

/** A folded name card for a desk (one face). */
export function deskCard(name: string): Texture {
  const W = 512, H = 160;
  const [c, ctx] = make(W, H);
  ctx.fillStyle = '#f6f0e4';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#c99a3f';
  ctx.fillRect(0, H - 10, W, 10);
  ctx.fillStyle = '#1e1a16';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  ctx.font = `600 ${size}px Fraunces, Georgia, serif`;
  while (ctx.measureText(name).width > W - 40 && size > 30) {
    size -= 4;
    ctx.font = `600 ${size}px Fraunces, Georgia, serif`;
  }
  ctx.fillText(name, W / 2, H / 2 - 4, W - 30);
  const t = tex(c);
  return t;
}

/** Wall clock face. */
export function clockFace(): Texture {
  const [c, ctx] = make(256, 256);
  ctx.fillStyle = '#f6f1e7';
  ctx.beginPath();
  ctx.arc(128, 128, 126, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a2119';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const long = i % 5 === 0;
    ctx.lineWidth = long ? 5 : 1.5;
    const r1 = long ? 96 : 106;
    ctx.beginPath();
    ctx.moveTo(128 + Math.sin(a) * r1, 128 - Math.cos(a) * r1);
    ctx.lineTo(128 + Math.sin(a) * 114, 128 - Math.cos(a) * 114);
    ctx.stroke();
  }
  ctx.fillStyle = '#6b5d4f';
  ctx.font = '600 13px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MEETO360', 128, 88);
  return tex(c);
}

/** Wait (briefly) for the web fonts so paintings with text use them. */
export async function fontsReady() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('italic 400 32px Fraunces'),
        document.fonts.load('600 30px Inter'),
      ]),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  } catch {
    /* system fonts are fine */
  }
}
