import { BOARD_H, BOARD_W, pageRect, pageStrokes, type BoardState } from '@net360/protocol';
import { BOARD_BG, drawStroke, slideInk } from './draw.ts';
import { slideImage } from './renderer.ts';

/**
 * Render one board page to an offscreen canvas (for saving notes). A slide page is
 * cut to the page itself (a portrait PDF page stays portrait); `long` is the longer side.
 */
export function renderPage(state: BoardState, pg: number, long = 2400): HTMLCanvasElement {
  const [vx, vy, vw, vh] = pageRect(state, pg);
  const k = long / Math.max(vw, vh);
  const c = document.createElement('canvas');
  c.width = Math.round(vw * k);
  c.height = Math.round(vh * k);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(k, 0, 0, k, -vx * k, -vy * k);
  const bg = state.bg?.[pg];
  const im = bg ? slideImage(bg, () => undefined) : null;
  if (im) ctx.drawImage(im, 0, 0, BOARD_W, BOARD_H);
  for (const s of pageStrokes(state, pg)) drawStroke(ctx, { ...(bg ? slideInk(s) : s), done: true });
  return c;
}

/** Pages that have a slide or at least one visible stroke. */
export function pagesWithInk(state: BoardState): number[] {
  const out: number[] = [];
  for (let pg = 0; pg < state.pages; pg++) if (state.bg?.[pg] || pageStrokes(state, pg).length) out.push(pg);
  return out;
}

/** Load every slide image on the board (before saving notes). */
export function loadSlides(state: BoardState): Promise<void> {
  const imgs = Object.values(state.bg ?? {});
  return Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((done) => {
          if (slideImage(img, done)) done();
        }),
    ),
  ).then(() => undefined);
}
