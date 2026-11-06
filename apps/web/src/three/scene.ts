import {
  ACESFilmicToneMapping,
  Plane,
  Raycaster,
  Vector2,
  CanvasTexture,
  Color,
  LinearFilter,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { BOARD, buildRoom, type Room } from './room.ts';
import { PeopleLayer, type PersonInRoom } from './people.ts';
import { fontsReady, slateBackground, welcomeBoard } from './textures.ts';

/**
 * student   — from the student's own desk, zoomable all the way to the board
 * teacher   — the whole class and the board; the teacher writes straight onto it
 * display   — the classroom TV: the whole front wall, board centred
 * classview — the teacher's view from the board, looking at the students
 * lobby     — behind the sign-in card: the room, slowly drifting
 */
export type View = 'student' | 'teacher' | 'display' | 'classview' | 'lobby';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const BOARD_TEX = { w: 2048, h: 1152 };

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export function isSmallDevice() {
  return navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820;
}

export class ClassroomScene {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(38, 1, 0.1, 60);
  private room: Room;
  private people: PeopleLayer;
  private boardCanvas: HTMLCanvasElement;
  private boardCtx: CanvasRenderingContext2D;
  private boardTex: CanvasTexture;
  private slate: HTMLCanvasElement;
  private source: { committed: HTMLCanvasElement; live: HTMLCanvasElement } | null = null;
  private ro: ResizeObserver;
  private dirty = true;
  private width = 1;
  private height = 1;
  private pointer = { x: 0, y: 0 };
  private offset = { x: 0, y: 0 };
  private base = { pos: new Vector3(), target: new Vector3() };
  private t0 = performance.now();
  private lastRect = '';
  private clockTimer: number;
  private reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  /** Student view: where their desk is, and how far they have zoomed toward the board (0 desk … 1 board). */
  private seat: Vector3 | null = null;
  private zoomTarget = 0;
  private zoomCur = 0;
  private poses = {
    desk: { pos: new Vector3(), target: new Vector3(), fov: 52 },
    board: { pos: new Vector3(), target: new Vector3(), fov: 40 },
  };
  private pinch = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private ray = new Raycaster();
  private boardPlane = new Plane(new Vector3(0, 0, 1), -BOARD.z);
  onBoardRect?: (r: Rect | null) => void;
  /** Student view: the zoom level changed (for the Desk / Board switch). */
  onZoom?: (t: number) => void;

  constructor(
    private host: HTMLElement,
    private view: View,
  ) {
    const small = isSmallDevice();
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = !small;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color('#2a2119');
    this.room = buildRoom({ shadows: !small });
    this.scene.add(this.room.group);
    this.people = new PeopleLayer(this.room.seats, this.room.teacherSpot);
    this.scene.add(this.people.group);

    // The board surface is a canvas we redraw whenever the ink changes.
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = BOARD_TEX.w;
    this.boardCanvas.height = BOARD_TEX.h;
    this.boardCtx = this.boardCanvas.getContext('2d')!;
    this.slate = slateBackground(BOARD_TEX.w, BOARD_TEX.h);
    this.boardTex = new CanvasTexture(this.boardCanvas);
    this.boardTex.colorSpace = SRGBColorSpace;
    this.boardTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.boardTex.minFilter = LinearFilter;
    this.boardTex.generateMipmaps = false;
    (this.room.board.material as MeshBasicMaterial).map = this.boardTex;
    (this.room.board.material as MeshBasicMaterial).color.set('#ffffff');
    this.composeBoard();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    if (view === 'student') {
      const el = this.renderer.domElement;
      el.addEventListener('wheel', this.onWheel, { passive: false });
      el.addEventListener('pointerdown', this.onPinchDown);
      el.addEventListener('pointermove', this.onPinchMove);
      el.addEventListener('pointerup', this.onPinchUp);
      el.addEventListener('pointercancel', this.onPinchUp);
    }
    this.clockTimer = window.setInterval(() => {
      this.room.tickClock();
      this.invalidate();
    }, 30_000);
    this.renderer.setAnimationLoop(() => this.frame());

    // Repaint the art once the web fonts arrive (equations on the plates).
    void fontsReady().then(() => {
      this.composeBoard();
      this.invalidate();
    });
  }

  /* ---------------- board ---------------- */

  /** Use a live board (two canvases from a BoardRenderer). */
  setBoardSource(src: { committed: HTMLCanvasElement; live: HTMLCanvasElement } | null) {
    this.source = src;
    this.boardChanged();
  }

  /** The ink changed: recomposite the board texture. */
  boardChanged() {
    this.composeBoard();
    this.invalidate();
  }

  private composeBoard() {
    const ctx = this.boardCtx;
    const { w, h } = BOARD_TEX;
    if (!this.source) {
      ctx.drawImage(this.view === 'lobby' ? welcomeBoard(w, h) : this.slate, 0, 0);
    } else {
      ctx.drawImage(this.slate, 0, 0);
      ctx.drawImage(this.source.committed, 0, 0, w, h);
      ctx.drawImage(this.source.live, 0, 0, w, h);
    }
    this.boardTex.needsUpdate = true;
  }

  /* ---------------- people ---------------- */

  setPeople(people: PersonInRoom[], teacherName: string | null, hideUid?: string) {
    this.people.update(people, hideUid);
    this.people.setTeacher(teacherName);
    this.invalidate();
  }

  setShowNames(show: boolean) {
    this.people.setShowNames(show);
    this.invalidate();
  }

  /* ---------------- camera ---------------- */

  private frameView() {
    const aspect = this.width / this.height;
    const cam = this.camera;
    const fit = (boardFrac: number, heightFrac: number, fov: number) => {
      const t = Math.tan(((fov / 2) * Math.PI) / 180);
      const dW = BOARD.w / boardFrac / 2 / (t * aspect);
      const dH = BOARD.h / heightFrac / 2 / t;
      return Math.min(14.2, Math.max(dW, dH));
    };
    switch (this.view) {
      case 'student': {
        // Desk: the student's own seat, at seated eye height, looking at the board.
        const seat = this.seat ?? new Vector3(0, 0.47, 7.3);
        this.poses.desk.pos.set(seat.x * 0.94, 1.42, seat.z - 0.05);
        this.poses.desk.target.set(0, BOARD.y - 0.32, 0);
        // Wide enough that the whole board fits from this seat, with the own desk at the bottom.
        const dist = this.poses.desk.pos.distanceTo(new Vector3(0, BOARD.y, BOARD.z));
        const deg = (r: number) => (r * 180) / Math.PI;
        const byHeight = 2 * deg(Math.atan((BOARD.h * 0.5 * 1.45) / dist));
        const byWidth = 2 * deg(Math.atan((BOARD.w * 0.5 * 1.18) / (dist * aspect)));
        this.poses.desk.fov = Math.min(80, Math.max(42, byHeight, byWidth) + 4);
        // Board: straight in front of it, filling the screen.
        const boardFov = 40;
        const d = fit(0.97, 0.93, boardFov);
        this.poses.board.pos.set(0, BOARD.y, BOARD.z + d);
        this.poses.board.target.set(0, BOARD.y, 0);
        this.poses.board.fov = boardFov;
        this.applyZoom();
        break;
      }
      case 'teacher': {
        cam.fov = 36;
        const d = fit(0.64, 0.6, 36);
        this.base.pos.set(0, 2.45, BOARD.z + d);
        this.base.target.set(0, BOARD.y - 0.36, 0);
        break;
      }
      case 'display': {
        cam.fov = 34;
        const d = fit(0.56, 0.56, 34);
        this.base.pos.set(0, 2.35, BOARD.z + d);
        this.base.target.set(0, BOARD.y - 0.3, 0);
        break;
      }
      case 'classview': {
        cam.fov = aspect < 1.2 ? 64 : 52;
        this.base.pos.set(0, 3.1, 0.9);
        this.base.target.set(0, 0.6, 9.5);
        break;
      }
      case 'lobby': {
        cam.fov = 42;
        this.base.pos.set(0, 2.0, 10.2);
        this.base.target.set(0, 2.15, 0);
        break;
      }
    }
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }

  /** Blend the desk and board poses by the current zoom. */
  private applyZoom() {
    const t = this.zoomCur;
    const e = t * t * (3 - 2 * t); // smoothstep
    const { desk, board } = this.poses;
    this.base.pos.lerpVectors(desk.pos, board.pos, e);
    this.base.target.lerpVectors(desk.target, board.target, e);
    this.camera.fov = desk.fov + (board.fov - desk.fov) * e;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- student: seat and zoom ---------------- */

  /** Seat number from the server (join order); null before the student is seated. */
  setSeat(index: number | null) {
    this.seat = index === null ? null : this.room.seats[index % this.room.seats.length].clone();
    this.frameView();
    this.invalidate();
  }

  /** 0 = from the desk, 1 = the board fills the screen. */
  setZoom(t: number) {
    this.zoomTarget = Math.max(0, Math.min(1, t));
    this.invalidate();
  }

  get zoom() {
    return this.zoomTarget;
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.setZoom(this.zoomTarget - e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
  };

  private onPinchDown = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size === 2) this.pinchDist = this.pinchSpan();
  };

  private onPinchMove = (e: PointerEvent) => {
    if (!this.pinch.has(e.pointerId)) return;
    this.pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch.size === 2) {
      const d = this.pinchSpan();
      if (this.pinchDist) this.setZoom(this.zoomTarget + (d - this.pinchDist) / 320);
      this.pinchDist = d;
    }
  };

  private onPinchUp = (e: PointerEvent) => {
    this.pinch.delete(e.pointerId);
    this.pinchDist = 0;
  };

  private pinchSpan() {
    const [a, b] = [...this.pinch.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /* ---------------- teacher: writing on the 3D board ---------------- */

  /** Screen point → board units (0…1600 × 0…900), by casting a ray onto the board. */
  boardPoint = (clientX: number, clientY: number): [number, number] => {
    const r = this.host.getBoundingClientRect();
    const ndc = new Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new Vector3();
    if (!this.ray.ray.intersectPlane(this.boardPlane, hit)) return [-1, -1];
    return [((hit.x + BOARD.w / 2) / BOARD.w) * 1600, ((BOARD.y + BOARD.h / 2 - hit.y) / BOARD.h) * 900];
  };

  private onPointer = (e: PointerEvent) => {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
    this.invalidate();
  };

  private resize() {
    const r = this.host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    this.renderer.setSize(r.width, r.height, false);
    this.frameView();
    this.invalidate();
  }

  invalidate() {
    this.dirty = true;
  }

  private frame() {
    const lobby = this.view === 'lobby' && !this.reduceMotion;
    let zooming = false;
    if (this.view === 'student' && Math.abs(this.zoomTarget - this.zoomCur) > 0.0005) {
      this.zoomCur += (this.zoomTarget - this.zoomCur) * (this.reduceMotion ? 1 : 0.14);
      if (Math.abs(this.zoomTarget - this.zoomCur) <= 0.0005) this.zoomCur = this.zoomTarget;
      this.applyZoom();
      this.onZoom?.(this.zoomCur);
      zooming = true;
    }
    // Gentle parallax toward the pointer — never while writing (teacher) or reading close up.
    const fixed = this.view === 'classview' || this.view === 'teacher' || this.reduceMotion;
    const k = fixed ? 0 : this.view === 'student' ? 0.6 * (1 - this.zoomCur) : 1;
    const tx = this.pointer.x * 0.32 * k;
    const ty = -this.pointer.y * 0.12 * k;
    const moving = Math.abs(tx - this.offset.x) > 0.0005 || Math.abs(ty - this.offset.y) > 0.0005;
    this.offset.x += (tx - this.offset.x) * 0.08;
    this.offset.y += (ty - this.offset.y) * 0.08;
    if (!this.dirty && !moving && !lobby && !zooming) return;
    this.dirty = false;

    const cam = this.camera;
    cam.position.copy(this.base.pos);
    cam.position.x += this.offset.x;
    cam.position.y += this.offset.y;
    if (lobby) {
      const t = (performance.now() - this.t0) / 1000;
      cam.position.x += Math.sin(t * 0.12) * 1.4;
      cam.position.z += Math.sin(t * 0.08) * 0.6;
    }
    cam.lookAt(this.base.target);
    this.renderer.render(this.scene, cam);
    this.reportBoardRect();
  }

  /** Where the board is on screen, so DOM overlays (QR card, chips) can sit on it. */
  private reportBoardRect() {
    if (!this.onBoardRect) return;
    if (this.view === 'classview' || this.view === 'lobby') {
      if (this.lastRect !== 'none') {
        this.lastRect = 'none';
        this.onBoardRect(null);
      }
      return;
    }
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const v = new Vector3((sx * BOARD.w) / 2, BOARD.y + (sy * BOARD.h) / 2, BOARD.z).project(this.camera);
      xs.push(((v.x + 1) / 2) * this.width);
      ys.push(((1 - v.y) / 2) * this.height);
    }
    const r = { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const key = [r.left, r.top, r.width, r.height].map((n) => Math.round(n)).join(',');
    if (key !== this.lastRect) {
      this.lastRect = key;
      this.onBoardRect(r);
    }
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('pointermove', this.onPointer);
    const el = this.renderer.domElement;
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onPinchDown);
    el.removeEventListener('pointermove', this.onPinchMove);
    el.removeEventListener('pointerup', this.onPinchUp);
    el.removeEventListener('pointercancel', this.onPinchUp);
    clearInterval(this.clockTimer);
    this.ro.disconnect();
    this.scene.traverse((o) => {
      const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } } };
      m.geometry?.dispose();
      m.material?.map?.dispose();
      m.material?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
