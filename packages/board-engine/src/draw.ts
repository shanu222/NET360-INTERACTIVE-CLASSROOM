import { getStroke } from 'perfect-freehand';
import type { Stroke, StrokeStyle } from '@net360/protocol';

/** Board ink palette — tuned for the dark slate board. */
export const INK = {
  chalk: '#F4F1EA',
  amber: '#F2B44C',
  sky: '#7CC4F5',
  mint: '#7EE0B5',
  coral: '#FF8A7A',
} as const;

export const BOARD_BG = '#1C2A27';

/** On a (white) slide the light board inks are drawn in strong, readable versions. */
const ON_SLIDE: Record<string, string> = {
  [INK.chalk.toLowerCase()]: '#1B2A4A',
  [INK.amber.toLowerCase()]: '#C46A00',
  [INK.sky.toLowerCase()]: '#1565C0',
  [INK.mint.toLowerCase()]: '#0F7B4F',
  [INK.coral.toLowerCase()]: '#D3362A',
};
export function slideInk<T extends { st: { c: string } }>(s: T): T {
  const c = ON_SLIDE[s.st.c.toLowerCase()];
  return c ? { ...s, st: { ...s.st, c } } : s;
}

/** Turn a perfect-freehand outline into a smooth closed Path2D. */
function outlineToPath(outline: number[][]): Path2D {
  const path = new Path2D();
  const n = outline.length;
  if (n < 2) return path;
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < n; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % n];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

function triples(pts: number[]): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 2 < pts.length; i += 3) out.push([pts[i], pts[i + 1], pts[i + 2]]);
  return out;
}

/** Filled outline for pen/highlighter strokes (board units). */
export function freehandPath(st: StyleLike, pts: number[], done: boolean): Path2D {
  const outline = getStroke(triples(pts), {
    size: st.w,
    thinning: st.tool === 'highlighter' ? 0 : 0.55,
    smoothing: 0.55,
    streamline: 0.42,
    simulatePressure: Boolean(st.sim),
    last: done,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
  });
  return outlineToPath(outline);
}

type StyleLike = Pick<StrokeStyle, 'tool' | 'w' | 'sim'>;

/** Outline of a shape tool between its first and last point (board units). */
export function shapePath(tool: StrokeStyle['tool'], x0: number, y0: number, x1: number, y1: number, w: number): Path2D {
  const p = new Path2D();
  switch (tool) {
    case 'line':
      p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      break;
    case 'arrow': {
      p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      const a = Math.atan2(y1 - y0, x1 - x0);
      const head = Math.max(14, w * 4);
      p.moveTo(x1, y1);
      p.lineTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
      p.moveTo(x1, y1);
      p.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
      break;
    }
    case 'rect':
      p.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      break;
    case 'circle':
      p.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
      break;
    default:
      break;
  }
  return p;
}

export const isShape = (tool: StrokeStyle['tool']) => tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'circle';

const cache = new WeakMap<Stroke, { v: number; path: Path2D }>();

/** Draw one stroke. `ctx` must already be transformed to board units. */
export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  const { st, pts } = s;
  if (pts.length < 3) return;
  ctx.save();
  if (isShape(st.tool)) {
    const n = pts.length;
    const path = shapePath(st.tool, pts[0], pts[1], pts[n - 3], pts[n - 2], st.w);
    ctx.strokeStyle = st.c;
    ctx.lineWidth = st.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(path);
  } else {
    let entry = cache.get(s);
    if (!entry || entry.v !== s.v) {
      entry = { v: s.v, path: freehandPath(st, pts, s.done) };
      if (s.done) cache.set(s, entry);
    }
    if (st.tool === 'highlighter') {
      // On a dark board a highlighter should glow, not muddy: lighten what is beneath.
      ctx.globalAlpha = 0.62;
      ctx.globalCompositeOperation = 'screen';
    }
    ctx.fillStyle = st.c;
    ctx.fill(entry.path);
  }
  ctx.restore();
}
