import { BOARD_H, BOARD_W, pageStrokes, type BoardState, type Stroke } from '@net360/protocol';
import type { BoardSession } from './session.ts';
import { drawStroke, slideInk } from './draw.ts';

export type OverlayFn = (ctx: CanvasRenderingContext2D) => void;

/** Slide images, loaded once per page and shared by every board on the page. */
const slideImages = new Map<string, HTMLImageElement>();
const slideWaiters = new Map<string, Set<() => void>>();

/** Turns a slide reference into a URL (set once by the app; see setSlideUrl). */
let slideUrl = (img: string) => img;
export function setSlideUrl(fn: (img: string) => string) {
  slideUrl = fn;
}

/** The slide image if it's ready; otherwise starts loading it and calls `ready` when done. */
export function slideImage(img: string, ready: () => void): HTMLImageElement | null {
  const have = slideImages.get(img);
  if (have?.complete && have.naturalWidth) return have;
  let waiters = slideWaiters.get(img);
  if (!waiters) slideWaiters.set(img, (waiters = new Set()));
  waiters.add(ready);
  if (!have) {
    const el = new Image();
    // Boards draw slides into canvases that the 3D room uploads to the GPU.
    el.crossOrigin = 'anonymous';
    el.decoding = 'async';
    const done = () => {
      const w = slideWaiters.get(img);
      slideWaiters.delete(img);
      w?.forEach((f) => f());
    };
    el.onload = done;
    el.onerror = () => {
      slideImages.delete(img); // try again next time
      done();
    };
    el.src = slideUrl(img);
    slideImages.set(img, el);
  }
  return null;
}

/**
 * Two stacked canvases inside a 16:9 host element:
 *  - committed: finished strokes, redrawn only when something structural changes;
 *  - live: strokes still being written plus local previews, redrawn per frame while dirty.
 * Both draw in logical board units (1600 × 900) scaled to the host size.
 */
export class BoardRenderer {
  readonly committed: HTMLCanvasElement;
  readonly live: HTMLCanvasElement;
  private cctx: CanvasRenderingContext2D;
  private lctx: CanvasRenderingContext2D;
  private scale = 1;
  private dpr = 1;
  private dirtyCommitted = true;
  private dirtyLive = true;
  private raf = 0;
  private ro: ResizeObserver;
  private off: () => void;
  /** Page shown; null = follow the teacher's current page. */
  private viewPage: number | null = null;
  /** Always show the page this picks (split screen: one half the slide, the other the whiteboard). */
  private pin: ((s: BoardState) => number | null) | null = null;
  overlay: OverlayFn | null = null;
  onPageView?: (page: number, following: boolean) => void;
  /** Called after every redraw, saying which layer changed (the 3D classroom uploads only that). */
  onFrame?: (committed: boolean, live: boolean) => void;

  constructor(
    private host: HTMLElement,
    private session: BoardSession,
    private opts: { dpr?: number } = {},
  ) {
    this.committed = document.createElement('canvas');
    this.live = document.createElement('canvas');
    for (const c of [this.committed, this.live]) {
      Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none' });
      host.appendChild(c);
    }
    this.cctx = this.committed.getContext('2d')!;
    this.lctx = this.live.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.off = session.on((kind) => {
      if (kind === 'live') this.dirtyLive = true;
      else {
        this.dirtyCommitted = true;
        this.dirtyLive = true;
        this.onPageView?.(this.page, this.viewPage === null);
      }
      this.schedule();
    });
    this.resize();
  }

  /** Page currently on screen. */
  get page() {
    const s = this.session.state;
    if (this.pin) {
      const p = this.pin(s);
      if (p !== null && p >= 0 && p < s.pages) return p;
    }
    return this.viewPage === null ? s.page : Math.min(this.viewPage, s.pages - 1);
  }

  /** Browse to a page (students) — `null` returns to following the teacher. */
  setViewPage(pg: number | null) {
    this.viewPage = pg === null || pg === this.session.state.page ? null : pg;
    this.invalidate();
    this.onPageView?.(this.page, this.viewPage === null);
  }

  /** Show the page `fn` picks from the board (null: back to following the live page). */
  setPin(fn: ((s: BoardState) => number | null) | null) {
    this.pin = fn;
    this.invalidate();
    this.onPageView?.(this.page, this.viewPage === null);
  }

  invalidate() {
    this.dirtyCommitted = true;
    this.dirtyLive = true;
    this.schedule();
  }

  /** Redraw only the live layer (input previews). */
  invalidateLive() {
    this.dirtyLive = true;
    this.schedule();
  }

  /** Client coordinates → board units. */
  toBoard(clientX: number, clientY: number): [number, number] {
    const r = this.host.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * BOARD_W, ((clientY - r.top) / r.height) * BOARD_H];
  }

  get pixelsPerUnit() {
    return this.scale;
  }

  private resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // Cap at 2× so budget phones keep 60 fps.
    this.dpr = this.opts.dpr ?? Math.min(window.devicePixelRatio || 1, 2);
    this.scale = r.width / BOARD_W;
    for (const c of [this.committed, this.live]) {
      c.width = Math.round(r.width * this.dpr);
      c.height = Math.round(r.height * this.dpr);
    }
    this.invalidate();
  }

  private schedule() {
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  private prep(ctx: CanvasRenderingContext2D) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  private frame() {
    this.raf = 0;
    const strokes = pageStrokes(this.session.state, this.page);
    const bg = this.session.state.bg?.[this.page];
    const ink = (s: Stroke) => (bg ? slideInk(s) : s);
    const didCommitted = this.dirtyCommitted;
    const didLive = this.dirtyLive;
    if (this.dirtyCommitted) {
      this.dirtyCommitted = false;
      this.prep(this.cctx);
      // A slide sits behind the writing on its page.
      if (bg) {
        const im = slideImage(bg, () => this.invalidate());
        if (im) this.cctx.drawImage(im, 0, 0, BOARD_W, BOARD_H);
      }
      for (const s of strokes) if (s.done) drawStroke(this.cctx, ink(s));
    }
    if (this.dirtyLive) {
      this.dirtyLive = false;
      this.prep(this.lctx);
      const live: Stroke[] = strokes.filter((s) => !s.done);
      for (const s of live) drawStroke(this.lctx, ink(s));
      this.overlay?.(this.lctx);
    }
    this.onFrame?.(didCommitted, didLive);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.off();
    this.committed.remove();
    this.live.remove();
  }
}
