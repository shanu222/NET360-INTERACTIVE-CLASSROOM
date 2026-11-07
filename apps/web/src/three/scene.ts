import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Group,
  MeshStandardMaterial,
  Mesh,
  PlaneGeometry,
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
  private camera = new PerspectiveCamera(38, 1, 0.1, 120);
  private room: Room;
  private people: PeopleLayer;
  /** Ink sits on two transparent layers over the slate: finished strokes and strokes in progress. */
  private inkCommitted: Mesh;
  private inkLive: Mesh;
  private slateTex: CanvasTexture;
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
  /** Student "walk" mode: free movement around the room. */
  private walk = {
    on: false,
    pos: new Vector3(0, 1.62, 9),
    yaw: Math.PI, // facing the board (−z)
    pitch: 0,
    goal: null as Vector3 | null,
    keys: new Set<string>(),
    drag: null as { id: number; x: number; y: number; moved: number } | null,
    last: 0,
  };
  private floorPlane = new Plane(new Vector3(0, 1, 0), 0);
  /** Student: turning the head from the desk (no moving). */
  private look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0 };
  onBoardRect?: (r: Rect | null) => void;
  /** Student view: the zoom level changed (for the Desk / Board switch). */
  onZoom?: (t: number) => void;

  constructor(
    private host: HTMLElement,
    private view: View,
    /** Students the room is set out for (40 … 500). */
    students = 40,
  ) {
    const small = isSmallDevice();
    // Background-only views (sign-in, the teacher's small class view) render lighter.
    const light = view === 'lobby' || view === 'classview';
    this.renderer = new WebGLRenderer({ antialias: !light || !small, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, light ? 1.25 : small ? 1.5 : 1.75));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.shadowMap.enabled = !small && !light;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    // Checking every shader for errors makes the browser wait for each one to compile,
    // which freezes the page for a moment. Only do it while developing.
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
    Object.assign(this.renderer.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    host.appendChild(this.renderer.domElement);

    this.scene.background = new Color('#2a2119');
    // Big halls skip shadows on phones and in the small views; everywhere else they stay.
    this.room = buildRoom({ shadows: !small && !light, students });
    this.scene.add(this.room.group);
    this.people = new PeopleLayer(this.room.seats, this.room.teacherSpot);
    this.scene.add(this.people.group);

    // The board: a static slate (or the welcome message) with two ink layers on top.
    // Each layer uploads to the GPU only when it changes — finished strokes rarely,
    // the stroke being written once per frame while the pen moves.
    this.slateTex = this.canvasTexture(view === 'lobby' ? welcomeBoard(BOARD_TEX.w, BOARD_TEX.h) : slateBackground(BOARD_TEX.w, BOARD_TEX.h));
    const boardMat = this.room.board.material as MeshBasicMaterial;
    boardMat.map = this.slateTex;
    boardMat.color.set('#ffffff');
    const layer = (dz: number) => {
      const m = new Mesh(
        new PlaneGeometry(BOARD.w, BOARD.h),
        new MeshBasicMaterial({ transparent: true, toneMapped: false, depthWrite: false, visible: false }),
      );
      m.position.set(0, BOARD.y, BOARD.z + dz);
      m.renderOrder = 2;
      this.scene.add(m);
      return m;
    };
    this.inkCommitted = layer(0.002);
    this.inkLive = layer(0.004);

    // A lecture hall also shows the board on two screens either side, so the back rows can read it.
    // They share the board's materials: whatever is written appears on all three.
    if (this.room.dims.W >= 22) {
      const sw = BOARD.w * 0.86;
      const sh = BOARD.h * 0.86;
      const frameMat = new MeshStandardMaterial({ color: '#1c1b1d', roughness: 0.4, metalness: 0.3 });
      for (const side of [-1, 1]) {
        const g = new Group();
        g.add(new Mesh(new BoxGeometry(sw + 0.18, sh + 0.18, 0.06), frameMat));
        const face = (mat: MeshBasicMaterial, z: number) => {
          const m = new Mesh(new PlaneGeometry(sw, sh), mat);
          m.position.z = z;
          m.renderOrder = 2;
          g.add(m);
        };
        face(boardMat, 0.032);
        face(this.inkCommitted.material as MeshBasicMaterial, 0.034);
        face(this.inkLive.material as MeshBasicMaterial, 0.036);
        g.position.set(side * (4.85 + 1.2 + sw / 2), BOARD.y + 0.3, 0.08);
        g.rotation.y = -side * 0.16;
        this.scene.add(g);
      }
    }

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    if (view === 'student' || view === 'teacher') {
      const el = this.renderer.domElement;
      el.addEventListener('wheel', this.onWheel, { passive: false });
      el.addEventListener('pointerdown', this.onPinchDown);
      el.addEventListener('pointermove', this.onPinchMove);
      el.addEventListener('pointerup', this.onPinchUp);
      el.addEventListener('pointercancel', this.onPinchUp);
      el.addEventListener('pointerdown', this.onWalkDown);
      el.addEventListener('pointermove', this.onWalkMove);
      el.addEventListener('pointerup', this.onWalkUp);
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKey);
    }
    this.clockTimer = window.setInterval(() => {
      this.room.tickClock();
      this.invalidate();
    }, 30_000);
    if (view === 'lobby') {
      for (const ev of ['pointerdown', 'keydown', 'input'] as const) window.addEventListener(ev, this.onInput, { capture: true, passive: true });
    }
    // Compile the room's shaders in the background (where the browser supports it),
    // then start drawing — the page stays responsive meanwhile.
    const start = () => {
      if (!this.disposed) this.renderer.setAnimationLoop(() => this.frame());
    };
    this.renderer.compileAsync(this.scene, this.camera).then(start, start);

    // Repaint the welcome board once the web fonts arrive.
    if (view === 'lobby') {
      void fontsReady().then(() => {
        this.slateTex.image = welcomeBoard(BOARD_TEX.w, BOARD_TEX.h);
        this.slateTex.needsUpdate = true;
        this.invalidate();
      });
    }
  }

  /* ---------------- board ---------------- */

  private canvasTexture(c: HTMLCanvasElement) {
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    t.minFilter = LinearFilter;
    t.generateMipmaps = false;
    return t;
  }

  /** Use a live board (two canvases from a BoardRenderer). */
  setBoardSource(src: { committed: HTMLCanvasElement; live: HTMLCanvasElement } | null) {
    for (const [mesh, canvas] of [
      [this.inkCommitted, src?.committed],
      [this.inkLive, src?.live],
    ] as const) {
      const mat = mesh.material as MeshBasicMaterial;
      mat.map?.dispose();
      mat.map = canvas ? this.canvasTexture(canvas) : null;
      mat.visible = Boolean(canvas);
      mat.needsUpdate = true;
    }
    this.invalidate();
  }

  /** The ink changed: upload only the layer(s) that were redrawn. */
  boardChanged(committed = true, live = true) {
    const c = (this.inkCommitted.material as MeshBasicMaterial).map;
    const l = (this.inkLive.material as MeshBasicMaterial).map;
    if (committed && c) c.needsUpdate = true;
    if (live && l) l.needsUpdate = true;
    this.invalidate();
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
        // From above the board, looking down over every desk (higher in a big hall).
        const { D } = this.room.dims;
        const grow = Math.max(0, D - 16);
        cam.fov = aspect < 1.2 ? 64 : 52;
        this.base.pos.set(0, 3.1 + grow * 0.22, 0.9);
        this.base.target.set(0, 0.6, 9.5 + grow * 0.55);
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
    if (this.walk.on) this.leaveWalk();
    this.zoomTarget = Math.max(0, Math.min(1, t));
    // Choosing Desk or Board turns the head back to the front.
    this.look.tYaw = 0;
    this.look.tPitch = 0;
    this.invalidate();
  }

  get zoom() {
    return this.zoomTarget;
  }

  private onWheel = (e: WheelEvent) => {
    if (this.walk.on) {
      e.preventDefault();
      this.step(-e.deltaY * 0.004);
    } else if (this.view === 'student') {
      e.preventDefault();
      this.setZoom(this.zoomTarget - e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
    }
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
      if (this.pinchDist) {
        if (this.walk.on) this.step((d - this.pinchDist) / 90);
        else if (this.view === 'student') this.setZoom(this.zoomTarget + (d - this.pinchDist) / 320);
      }
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

  /* ---------------- student: walk around the room ---------------- */

  /** Start walking from wherever the camera is now. */
  setWalk(on: boolean) {
    if (on === this.walk.on) return;
    if (!on) {
      this.leaveWalk();
      return;
    }
    const dir = new Vector3();
    this.camera.getWorldDirection(dir);
    this.walk.pos.copy(this.camera.position).setY(1.62);
    this.clampWalk(this.walk.pos);
    this.walk.yaw = Math.atan2(dir.x, dir.z);
    this.walk.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.walk.goal = null;
    this.walk.on = true;
    this.walk.last = performance.now();
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  get walking() {
    return this.walk.on;
  }

  private leaveWalk() {
    this.walk.on = false;
    this.walk.keys.clear();
    this.walk.goal = null;
    this.frameView(); // back to this view's own camera (teacher: the whole class)
    this.invalidate();
  }

  private clampWalk(v: Vector3) {
    const { W, D } = this.room.dims;
    v.x = Math.max(-W / 2 + 0.7, Math.min(W / 2 - 0.7, v.x));
    v.z = Math.max(1.0, Math.min(D - 0.7, v.z));
    return v;
  }

  /** Move along the view direction (positive = forward). */
  private step(m: number) {
    const w = this.walk;
    w.goal = null;
    w.pos.x += Math.sin(w.yaw) * m;
    w.pos.z += Math.cos(w.yaw) * m;
    this.clampWalk(w.pos);
    this.invalidate();
  }

  private onWalkDown = (e: PointerEvent) => {
    const looking = this.view === 'student' && !this.walk.on;
    if ((!this.walk.on && !looking) || this.pinch.size > 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.walk.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  private onWalkMove = (e: PointerEvent) => {
    const d = this.walk.drag;
    if (!d || d.id !== e.pointerId || this.pinch.size > 1) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved += Math.abs(dx) + Math.abs(dy);
    d.x = e.clientX;
    d.y = e.clientY;
    if (!this.walk.on) {
      // Student turning their head from the desk: most of the way round, but seated.
      this.look.tYaw = Math.max(-2.7, Math.min(2.7, this.look.tYaw + dx * 0.005));
      this.look.tPitch = Math.max(-0.55, Math.min(0.5, this.look.tPitch - dy * 0.004));
      this.invalidate();
      return;
    }
    this.walk.yaw -= dx * 0.0045;
    this.walk.pitch = Math.max(-0.9, Math.min(0.75, this.walk.pitch - dy * 0.0035));
    this.invalidate();
  };

  private onWalkUp = (e: PointerEvent) => {
    const d = this.walk.drag;
    if (!d || d.id !== e.pointerId) return;
    this.walk.drag = null;
    if (!this.walk.on || d.moved > 8) return;
    // A tap: walk to the spot on the floor.
    const r = this.host.getBoundingClientRect();
    const ndc = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hit = new Vector3();
    if (this.ray.ray.intersectPlane(this.floorPlane, hit)) {
      this.walk.goal = this.clampWalk(new Vector3(hit.x, 1.62, hit.z));
      this.invalidate();
    }
  };

  private onKey = (e: KeyboardEvent) => {
    if (!this.walk.on || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') this.walk.keys.add(k);
    else this.walk.keys.delete(k);
    this.walk.goal = null;
    this.invalidate();
  };

  /** Advance walking; returns true while still moving. */
  private updateWalk(): boolean {
    const w = this.walk;
    const now = performance.now();
    const dt = Math.min(0.05, (now - w.last) / 1000);
    w.last = now;
    let moving = false;
    const k = w.keys;
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
    const turn = (k.has('a') || k.has('arrowleft') ? 1 : 0) - (k.has('d') || k.has('arrowright') ? 1 : 0);
    if (fwd || turn) {
      w.yaw += turn * 1.6 * dt;
      w.pos.x += Math.sin(w.yaw) * fwd * 2.4 * dt;
      w.pos.z += Math.cos(w.yaw) * fwd * 2.4 * dt;
      this.clampWalk(w.pos);
      moving = true;
    } else if (w.goal) {
      const to = w.goal.clone().sub(w.pos);
      const dist = Math.hypot(to.x, to.z);
      if (dist < 0.03) w.goal = null;
      else {
        const m = Math.min(dist, 2.6 * dt + dist * 0.04);
        w.pos.x += (to.x / dist) * m;
        w.pos.z += (to.z / dist) * m;
        moving = true;
      }
    }
    this.camera.position.copy(w.pos);
    const look = new Vector3(Math.sin(w.yaw) * Math.cos(w.pitch), Math.sin(w.pitch), Math.cos(w.yaw) * Math.cos(w.pitch));
    this.camera.lookAt(w.pos.clone().add(look));
    return moving;
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

  /** Lobby: when the person last typed or tapped (the background yields to them). */
  private lastInput = 0;
  private lastLobbyFrame = 0;
  private onInput = () => {
    this.lastInput = performance.now();
  };

  private frame() {
    const lobby = this.view === 'lobby' && !this.reduceMotion;
    if (this.view === 'lobby') {
      // The drifting background is decoration: pause it while someone types or taps,
      // and draw it at 30 frames a second, so the join card always responds instantly.
      const now = performance.now();
      if (now - this.lastInput < 450 || now - this.lastLobbyFrame < 32) return;
      this.lastLobbyFrame = now;
    }
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
    if (this.walk.on) {
      const walking = this.walk.keys.size > 0 || this.walk.goal !== null;
      if (!this.dirty && !walking) {
        this.walk.last = performance.now();
        return;
      }
      this.dirty = false;
      this.updateWalk();
      this.renderer.render(this.scene, this.camera);
      this.reportBoardRect();
      return;
    }
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
    if (this.view === 'student') {
      const L = this.look;
      const settling = Math.abs(L.tYaw - L.yaw) > 0.0005 || Math.abs(L.tPitch - L.pitch) > 0.0005;
      L.yaw += (L.tYaw - L.yaw) * 0.2;
      L.pitch += (L.tPitch - L.pitch) * 0.2;
      if (settling) this.dirty = true; // keep easing next frame
      // Fade the head-turn out as the student zooms toward the board.
      const k2 = 1 - this.zoomCur;
      if (Math.abs(L.yaw) > 0.0005 || Math.abs(L.pitch) > 0.0005) {
        cam.rotateOnWorldAxis(new Vector3(0, 1, 0), L.yaw * k2);
        cam.rotateX(L.pitch * k2);
      }
    }
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
      if (v.z > 1 || v.z < -1) {
        // Part of the board is behind the camera (looking away while walking).
        if (this.lastRect !== 'none') {
          this.lastRect = 'none';
          this.onBoardRect(null);
        }
        return;
      }
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

  private disposed = false;

  dispose() {
    this.disposed = true;
    for (const ev of ['pointerdown', 'keydown', 'input'] as const) window.removeEventListener(ev, this.onInput, { capture: true });
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('pointermove', this.onPointer);
    const el = this.renderer.domElement;
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('pointerdown', this.onPinchDown);
    el.removeEventListener('pointermove', this.onPinchMove);
    el.removeEventListener('pointerup', this.onPinchUp);
    el.removeEventListener('pointercancel', this.onPinchUp);
    el.removeEventListener('pointerdown', this.onWalkDown);
    el.removeEventListener('pointermove', this.onWalkMove);
    el.removeEventListener('pointerup', this.onWalkUp);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
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
