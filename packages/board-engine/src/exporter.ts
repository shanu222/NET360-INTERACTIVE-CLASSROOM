import { BOARD_H, BOARD_W, pageStrokes, type BoardState } from '@net360/protocol';
import { BOARD_BG, drawStroke, slideInk } from './draw.ts';
import { slideImage } from './renderer.ts';

/** Render one board page to an offscreen canvas (for saving notes). */
export function renderPage(state: BoardState, pg: number, width = 2400): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = Math.round((width * BOARD_H) / BOARD_W);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, c.width, c.height);
  const k = width / BOARD_W;
  ctx.setTransform(k, 0, 0, k, 0, 0);
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
