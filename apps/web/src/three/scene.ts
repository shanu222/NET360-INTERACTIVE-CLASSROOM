import {
  ACESFilmicToneMapping,
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
 * student   — from the class, facing the board (board large, classmates in front)
 * display   — the classroom TV: the whole front wall, board centred
 * classview — the teacher's view from the board, looking at the students
 * lobby     — behind the sign-in card: the room, slowly drifting
 */
export type View = 'student' | 'display' | 'classview' | 'lobby';

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
  onBoardRect?: (r: Rect | null) => void;

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
    const center = new Vector3(0, BOARD.y, BOARD.z);
    const fit = (boardFrac: number, heightFrac: number, fov: number) => {
      cam.fov = fov;
      const t = Math.tan(((fov / 2) * Math.PI) / 180);
      const dW = BOARD.w / boardFrac / 2 / (t * aspect);
      const dH = BOARD.h / heightFrac / 2 / t;
      return Math.min(14.2, Math.max(dW, dH));
    };
    switch (this.view) {
      case 'student': {
        // From the middle of the class: classmates in rows ahead, the board large and clear.
        const small = this.height < 520;
        const d = fit(small ? 0.74 : 0.62, small ? 0.62 : 0.56, 34);
        this.base.pos.set(0, 2.2, BOARD.z + d);
        this.base.target.set(0, BOARD.y - 0.42, 0);
        break;
      }
      case 'display': {
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
    void center;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
  }

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
    // Gentle parallax toward the pointer (not in the teacher's class view).
    const k = this.view === 'classview' || this.reduceMotion ? 0 : 1;
    const tx = this.pointer.x * 0.32 * k;
    const ty = -this.pointer.y * 0.12 * k;
    const moving = Math.abs(tx - this.offset.x) > 0.0005 || Math.abs(ty - this.offset.y) > 0.0005;
    this.offset.x += (tx - this.offset.x) * 0.08;
    this.offset.y += (ty - this.offset.y) * 0.08;
    if (!this.dirty && !moving && !lobby) return;
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
