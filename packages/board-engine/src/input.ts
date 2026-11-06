import { encodeAbs, pageStrokes, type Stroke, type StrokeStyle, type Tool } from '@net360/protocol';
import type { BoardSession } from './session.ts';
import type { BoardRenderer } from './renderer.ts';
import { isShape, shapePath } from './draw.ts';

export interface PenSettings {
  tool: Tool | 'eraser';
  color: string;
  width: number;
}

type UndoEntry = { kind: 'add' | 'hide'; ids: string[] };

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** Points are flushed to the network every frame (~16 ms) or every 8 points. */
const FLUSH_POINTS = 8;

/**
 * Captures pen-tablet / mouse / touch input on the board and turns it into
 * board events. Pen tablets (Wacom, XP-Pen, Huion) arrive as Pointer Events
 * with real pressure; `getCoalescedEvents()` recovers every sample the tablet
 * reports between screen frames.
 */
export class PenInput {
  enabled = true;
  private active: {
    pointerId: number;
    id: string;
    style: StrokeStyle;
    lastQ: [number, number];
    buf: number[];
    t0: number;
    lastFlush: number;
    shapeStart?: [number, number];
    shapeEnd?: [number, number];
  } | null = null;
  private erasing: { pointerId: number; hits: Set<string>; queued: string[] } | null = null;
  private penSeenAt = 0;
  private flushRaf = 0;
  private cursor: [number, number] | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;

  constructor(
    private el: HTMLElement,
    private session: BoardSession,
    private renderer: BoardRenderer,
    private settings: () => PenSettings,
  ) {
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('pointerleave', this.leave);
    renderer.overlay = (ctx) => this.drawOverlay(ctx);
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this.down);
    this.el.removeEventListener('pointermove', this.move);
    this.el.removeEventListener('pointerup', this.up);
    this.el.removeEventListener('pointercancel', this.up);
    this.el.removeEventListener('pointerleave', this.leave);
    this.renderer.overlay = null;
  }

  /* ---------------- history ---------------- */

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    this.session.local(e.kind === 'add' ? { t: 'h', ids: e.ids } : { t: 'u', ids: e.ids });
    this.redoStack.push(e);
    this.emitHistory();
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    this.session.local(e.kind === 'add' ? { t: 'u', ids: e.ids } : { t: 'h', ids: e.ids });
    this.undoStack.push(e);
    this.emitHistory();
  }

  /** Clear the current page (undoable — strokes are hidden, not destroyed). */
  clearPage() {
    const ids = pageStrokes(this.session.state, this.renderer.page).map((s) => s.id);
    if (!ids.length) return;
    this.session.local({ t: 'h', ids });
    this.push({ kind: 'hide', ids });
  }

  private push(e: UndoEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.emitHistory();
  }

  private emitHistory() {
    this.onHistory?.(this.undoStack.length > 0, this.redoStack.length > 0);
  }

  /* ---------------- pointer handling ---------------- */

  private accept(e: PointerEvent) {
    if (!this.enabled) return false;
    if (e.pointerType === 'pen') this.penSeenAt = performance.now();
    // Palm rejection: ignore touch while a pen has been active recently.
    if (e.pointerType === 'touch' && performance.now() - this.penSeenAt < 1500) return false;
    return true;
  }

  private pressure(e: PointerEvent) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    return 0.5;
  }

  private down = (e: PointerEvent) => {
    if (!this.accept(e) || (e.button !== 0 && e.pointerType === 'mouse')) return;
    if (this.active || this.erasing) return;
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const cfg = this.settings();
    const [x, y] = this.renderer.toBoard(e.clientX, e.clientY);

    if (cfg.tool === 'eraser' || e.button === 5 || (e.buttons & 32) !== 0) {
      this.erasing = { pointerId: e.pointerId, hits: new Set(), queued: [] };
      this.cursor = [x, y];
      this.eraseAt(x, y);
      return;
    }

    const style: StrokeStyle = {
      tool: cfg.tool,
      c: cfg.color,
      w: cfg.tool === 'highlighter' ? cfg.width * 4 : cfg.width,
      sim: e.pointerType !== 'pen' || undefined,
    };
    const id = newId();
    const q = encodeAbs(x, y, this.pressure(e));
    this.active = { pointerId: e.pointerId, id, style, lastQ: [q[0], q[1]], buf: [], t0: performance.now(), lastFlush: performance.now() };

    if (isShape(cfg.tool)) {
      // Shapes are previewed locally and sent whole on release.
      this.active.shapeStart = [x, y];
      this.active.shapeEnd = [x, y];
      this.renderer.invalidateLive();
      return;
    }
    this.session.local({ t: 's', id, pg: this.renderer.page, st: style, p: q });
  };

  private move = (e: PointerEvent) => {
    if (e.pointerType === 'pen') this.penSeenAt = performance.now();
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = samples.length ? samples : [e];

    if (this.erasing && e.pointerId === this.erasing.pointerId) {
      for (const s of list) {
        const [x, y] = this.renderer.toBoard(s.clientX, s.clientY);
        this.eraseAt(x, y);
        this.cursor = [x, y];
      }
      this.renderer.invalidateLive();
      return;
    }
    if (!this.active || e.pointerId !== this.active.pointerId) {
      if (this.settings().tool === 'eraser' && this.enabled) {
        this.cursor = this.renderer.toBoard(e.clientX, e.clientY);
        this.renderer.invalidateLive();
      }
      return;
    }
    const a = this.active;
    if (a.shapeStart) {
      a.shapeEnd = this.renderer.toBoard(e.clientX, e.clientY);
      this.renderer.invalidateLive();
      return;
    }
    for (const s of list) {
      const [x, y] = this.renderer.toBoard(s.clientX, s.clientY);
      const q = encodeAbs(x, y, this.pressure(s));
      const dx = q[0] - a.lastQ[0];
      const dy = q[1] - a.lastQ[1];
      if (dx === 0 && dy === 0) continue;
      a.buf.push(dx, dy, q[2]);
      a.lastQ = [q[0], q[1]];
    }
    if (a.buf.length >= FLUSH_POINTS * 3) this.flush();
    else if (!this.flushRaf) this.flushRaf = requestAnimationFrame(() => this.flush());
  };

  private flush() {
    if (this.flushRaf) cancelAnimationFrame(this.flushRaf);
    this.flushRaf = 0;
    const a = this.active;
    if (!a || !a.buf.length) return;
    this.session.local({ t: 'p', id: a.id, p: a.buf, d: Math.round(performance.now() - a.t0) });
    a.buf = [];
    a.lastFlush = performance.now();
  }

  private up = (e: PointerEvent) => {
    if (this.erasing && e.pointerId === this.erasing.pointerId) {
      this.flushErase();
      if (this.erasing.hits.size) this.push({ kind: 'hide', ids: [...this.erasing.hits] });
      this.erasing = null;
      if (e.pointerType !== 'mouse') this.cursor = null;
      this.renderer.invalidateLive();
      return;
    }
    const a = this.active;
    if (!a || e.pointerId !== a.pointerId) return;
    this.active = null;
    if (a.shapeStart && a.shapeEnd) {
      const [x0, y0] = a.shapeStart;
      const [x1, y1] = a.shapeEnd;
      this.renderer.invalidateLive();
      if (Math.hypot(x1 - x0, y1 - y0) < 4) return;
      this.session.local({ t: 's', id: a.id, pg: this.renderer.page, st: a.style, p: [...encodeAbs(x0, y0, 0.5), ...encodeAbs(x1, y1, 0.5)] });
      this.session.local({ t: 'e', id: a.id });
      this.push({ kind: 'add', ids: [a.id] });
      return;
    }
    this.active = a;
    this.flush();
    this.active = null;
    this.session.local({ t: 'e', id: a.id });
    this.push({ kind: 'add', ids: [a.id] });
  };

  private leave = () => {
    if (!this.erasing && this.cursor) {
      this.cursor = null;
      this.renderer.invalidateLive();
    }
  };

  /* ---------------- eraser ---------------- */

  private get eraseRadius() {
    return Math.max(10, this.settings().width * 3);
  }

  private eraseAt(x: number, y: number) {
    const er = this.erasing!;
    const r = this.eraseRadius;
    for (const s of pageStrokes(this.session.state, this.renderer.page)) {
      if (er.hits.has(s.id) || !s.done) continue;
      if (hitStroke(s, x, y, r)) {
        er.hits.add(s.id);
        er.queued.push(s.id);
      }
    }
    if (er.queued.length) this.flushErase();
  }

  private flushErase() {
    const er = this.erasing;
    if (!er || !er.queued.length) return;
    this.session.local({ t: 'h', ids: er.queued });
    er.queued = [];
  }

  /* ---------------- local preview ---------------- */

  private drawOverlay(ctx: CanvasRenderingContext2D) {
    const a = this.active;
    if (a?.shapeStart && a.shapeEnd) {
      ctx.save();
      ctx.strokeStyle = a.style.c;
      ctx.lineWidth = a.style.w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(shapePath(a.style.tool, a.shapeStart[0], a.shapeStart[1], a.shapeEnd[0], a.shapeEnd[1], a.style.w));
      ctx.restore();
    }
    if (this.cursor && this.settings().tool === 'eraser') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(this.cursor[0], this.cursor[1], this.eraseRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(244,241,234,0.55)';
      ctx.lineWidth = 1.5 / Math.max(this.renderer.pixelsPerUnit, 0.1);
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }
}

/* ---------------- hit testing ---------------- */

function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const p = s.pts;
  const tol = r + s.st.w / 2;
  if (isShape(s.st.tool)) {
    const n = p.length;
    const [x0, y0, x1, y1] = [p[0], p[1], p[n - 3], p[n - 2]];
    switch (s.st.tool) {
      case 'rect': {
        const l = Math.min(x0, x1), rr = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
        return (
          distSeg(x, y, l, t, rr, t) < tol || distSeg(x, y, rr, t, rr, b) < tol ||
          distSeg(x, y, rr, b, l, b) < tol || distSeg(x, y, l, b, l, t) < tol
        );
      }
      case 'circle': {
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const rx = Math.max(Math.abs(x1 - x0) / 2, 1), ry = Math.max(Math.abs(y1 - y0) / 2, 1);
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        return Math.abs(d - 1) * Math.min(rx, ry) < tol;
      }
      default:
        return distSeg(x, y, x0, y0, x1, y1) < tol;
    }
  }
  if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) < tol;
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distSeg(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) < tol) return true;
  }
  return false;
}
