import {
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Vector3,
  type Texture,
} from 'three';
import * as Paint from './textures.ts';

/** Room artwork, painted once and reused (see `reuse` in textures.ts). */
const REUSED = new Set([
  'plaster', 'floorPlanks', 'oak', 'windowSky', 'plateMaxwell', 'plateSpiral', 'plateEuler', 'plateLens',
  'paintingLandscape', 'paintingOrbits', 'paintingSea', 'paintingNight', 'paintingPlanet', 'paintingBlooms',
  'paintingBalloons', 'paintingRainbow', 'inscription', 'quotePlate', 'clockFace',
]);
const T = new Proxy({ ...Paint }, {
  get(target, prop: string) {
    const v = (target as Record<string, unknown>)[prop];
    if (typeof v === 'function' && REUSED.has(prop)) {
      return (...a: unknown[]) => Paint.reuse(prop, v as (...x: unknown[]) => Texture, ...a);
    }
    return v;
  },
}) as typeof Paint;

const QUOTES: [string, string, string][] = [
  ['If I have seen further, it is by standing on the shoulders of giants.', 'Isaac Newton', 'Letter to Robert Hooke, 1675'],
  ['Nothing in life is to be feared, it is only to be understood.', 'Marie Curie', 'Physicist and chemist, Nobel 1903 & 1911'],
  ['Imagination is more important than knowledge.', 'Albert Einstein', 'Interview, 1929'],
  ['Measure what is measurable, and make measurable what is not so.', 'Galileo Galilei', 'Attributed'],
];
const INSCRIPTION = ['The important thing is not to stop questioning.', 'Albert Einstein'] as const;

/**
 * Paint all the room's artwork ahead of time, one piece per idle moment, so the
 * page keeps responding to taps and typing while the classroom gets ready.
 */
export async function prepareRoomArt(): Promise<void> {
  const jobs: (() => unknown)[] = [
    () => T.plaster('#efe6d6'), () => T.floorPlanks(), () => T.oak('#8f6b48', [6, 1]), () => T.windowSky(),
    () => T.oak('#4a3423'), () => T.oak('#8a643f'), () => T.oak('#6b4a30'),
    () => T.plateMaxwell(), () => T.plateSpiral(), () => T.plateEuler(), () => T.plateLens(),
    () => T.paintingLandscape(), () => T.paintingOrbits(), () => T.paintingSea(), () => T.paintingNight(),
    () => T.paintingPlanet(), () => T.paintingBlooms(), () => T.paintingBalloons(), () => T.paintingRainbow(),
    () => T.inscription(...INSCRIPTION), ...QUOTES.map((q) => () => T.quotePlate(...q)), () => T.clockFace(),
  ];
  const idle = () =>
    new Promise<void>((r) =>
      'requestIdleCallback' in window ? window.requestIdleCallback(() => r(), { timeout: 120 }) : setTimeout(r, 0),
    );
  for (const job of jobs) {
    await idle();
    job();
  }
}

/**
 * The classroom, in metres. Front wall (with the board) at z = 0, students face −z.
 *   width 14 (x −7…7) · depth 16 (z 0…16) · height 4.6
 */
export const ROOM = { W: 14, D: 16, H: 4.6 };
export const BOARD = { w: 5.6, h: 3.15, y: 1.15 + 3.15 / 2, z: 0.1 };

/** Desks across and rows deep, and the room that holds them. */
export interface Layout {
  cols: number;
  rows: number;
  /** Desk centres across (front-row order: from the middle outwards). */
  xs: number[];
  /** Row positions (desk front edge), front to back. */
  zs: number[];
  W: number;
  D: number;
  H: number;
  /** The one board on the front wall: larger in bigger rooms so the back rows can read it. */
  board: BoardSize;
}

export interface BoardSize {
  w: number;
  h: number;
  /** Height of its centre. */
  y: number;
  z: number;
}

/** Desks for every class size: a classroom for 40, up to an auditorium for 500. */
export function layoutFor(students: number): Layout {
  const [cols, rows] = students <= 42 ? [6, 7] : students <= 64 ? [8, 8] : students <= 156 ? [12, 13] : students <= 304 ? [16, 19] : [20, 25];
  // Pairs of desks 1.68 m apart; bigger rooms get a centre aisle and one every eight desks.
  const aisle = cols >= 12 ? 1.1 : 0;
  const half: number[] = [];
  for (let k = 0; k < cols / 2; k++) half.push(0.84 + k * 1.68 + aisle / 2 + Math.floor(k / 4) * (cols >= 16 ? 0.9 : 0));
  const xs = half.flatMap((x) => [-x, x]);
  // One board, scaled with the room: 5.6 m wide for 40 students, about 10.6 m for 500.
  const s = rows <= 7 ? 1 : rows <= 8 ? 1.06 : rows <= 13 ? 1.35 : rows <= 19 ? 1.65 : 1.9;
  const bw = BOARD.w * s;
  const bh = BOARD.h * s;
  const board = { w: bw, h: bh, y: 1.15 + bh / 2, z: BOARD.z };
  // The first row sits further back from a bigger board.
  const pitch = 1.4;
  const first = 3.7 + (s - 1) * 3;
  const zs = Array.from({ length: rows }, (_, r) => first + r * pitch);
  const W = Math.max(ROOM.W, 2 * (half[half.length - 1] + 2.3), bw + 2 * 3.6);
  const D = Math.max(ROOM.D, zs[zs.length - 1] + 0.62 + 3.2);
  const H = Math.max(ROOM.H + Math.min(2, (D - ROOM.D) * 0.06), 1.15 + bh + 0.9);
  return { cols, rows, xs, zs, W, D, H, board };
}

export interface Room {
  group: Group;
  /** The live board surface; its material map is replaced with the board texture. */
  board: Mesh;
  /** Seat positions (where a seated student's hips are), front rows first. */
  seats: Vector3[];
  /** Where the teacher stands, facing the class. */
  teacherSpot: Vector3;
  /** Moves the clock hands to now. */
  tickClock: () => void;
  sun: DirectionalLight;
  /** Room size in metres (width, depth, height). */
  dims: { W: number; D: number; H: number; board: BoardSize };
}

const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial(o);

function box(w: number, h: number, d: number, mat: MeshStandardMaterial | MeshBasicMaterial, x: number, y: number, z: number, shadows = true) {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

/** A framed artwork hung flat on a wall. `ry` turns it to face into the room. */
function framed(art: Texture, w: number, h: number, frameColor: string, mat: boolean, glow = 0) {
  const g = new Group();
  const frameW = 0.06;
  const frame = std({ color: frameColor, roughness: 0.45, metalness: 0.15 });
  g.add(box(w + frameW * 2, h + frameW * 2, 0.05, frame, 0, 0, 0, false));
  if (mat) g.add(box(w + 0.001, h + 0.001, 0.052, std({ color: '#f3ecdf', roughness: 0.9 }), 0, 0, 0.001, false));
  const inner = mat ? 0.82 : 1;
  // `glow` lifts prints with text a little above the room light, so they stay crisp and readable.
  const canvas = new Mesh(
    new PlaneGeometry(w * inner, h * inner),
    std({ map: art, roughness: 0.75, ...(glow ? { emissive: '#ffffff', emissiveMap: art, emissiveIntensity: glow } : {}) }),
  );
  canvas.position.z = 0.03;
  g.add(canvas);
  return g;
}

export function buildRoom(opts: { shadows: boolean; students?: number }): Room {
  const lay = layoutFor(opts.students ?? 40);
  const { W, D, H } = lay;
  // Positions along the side walls were set for a 16 m room; spread them out in bigger ones.
  const along = (z: number) => (z / ROOM.D) * D;
  const g = new Group();

  /* ---------- shell ---------- */
  const wallMat = std({ map: T.plaster('#efe6d6'), roughness: 0.95 });
  // One plank tile is 2 m: a bigger room repeats it more (same picture, no new upload).
  let planks = T.floorPlanks();
  if (W !== ROOM.W || D !== ROOM.D) {
    planks = planks.clone();
    planks.repeat.set(W / 2, D / 2);
  }
  const floor = new Mesh(new PlaneGeometry(W, D), std({ map: planks, roughness: 0.62, metalness: 0.02 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, D / 2);
  floor.receiveShadow = true;
  g.add(floor);

  // A high hall ceiling gets little light from below; let it glow a little so it stays pale.
  const ceiling = new Mesh(
    new PlaneGeometry(W, D),
    std({ color: '#f2ece2', roughness: 1, ...(D > ROOM.D ? { emissive: '#d9cfbf', emissiveIntensity: 0.55 } : {}) }),
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, H, D / 2);
  g.add(ceiling);

  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = new Mesh(new PlaneGeometry(w, H), wallMat);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    g.add(m);
  };
  wall(W, 0, 0, 0); // front
  wall(W, 0, D, Math.PI); // back
  wall(D, -W / 2, D / 2, Math.PI / 2); // left (windows)
  wall(D, W / 2, D / 2, -Math.PI / 2); // right

  /* ---------- oak wainscot, rails, baseboard ---------- */
  const panel = std({ map: T.oak('#8f6b48', [6, 1]), roughness: 0.6 });
  const rail = std({ color: '#5e432c', roughness: 0.5 });
  const wainH = 1.0;
  const runs: [number, number, number, number][] = [
    // [length, x, z, rotationY]
    [W, 0, 0.02, 0],
    [W, 0, D - 0.02, Math.PI],
    [D, -W / 2 + 0.02, D / 2, Math.PI / 2],
    [D, W / 2 - 0.02, D / 2, -Math.PI / 2],
  ];
  for (const [len, x, z, ry] of runs) {
    const p = box(len, wainH, 0.04, panel, 0, wainH / 2, 0);
    const top = box(len, 0.05, 0.08, rail, 0, wainH + 0.02, 0.02);
    const crown = box(len, 0.1, 0.06, std({ color: '#ece4d6', roughness: 0.9 }), 0, H - 0.05, 0.01, false);
    const grp = new Group();
    grp.add(p, top, crown);
    grp.position.set(x, 0, z);
    grp.rotation.y = ry;
    g.add(grp);
  }

  /* ---------- windows on the left wall ---------- */
  const sky = T.windowSky();
  const glass = new MeshBasicMaterial({ map: sky, toneMapped: false });
  const frameMat = std({ color: '#f4efe6', roughness: 0.6 });
  const windows = Math.max(3, Math.round(D / 5.3));
  for (let i = 0; i < windows; i++) {
    const z = 3.6 + (i * (D - 7.2)) / (windows - 1);
    const win = new Group();
    const ww = 2.2, wh = 2.5, wy = 2.45;
    const pane = new Mesh(new PlaneGeometry(ww, wh), glass);
    pane.position.set(0, wy, 0.005);
    win.add(pane);
    win.add(box(ww + 0.16, 0.08, 0.12, frameMat, 0, wy + wh / 2, 0.04, false));
    win.add(box(ww + 0.2, 0.08, 0.22, frameMat, 0, wy - wh / 2, 0.08, false));
    win.add(box(0.08, wh, 0.12, frameMat, -ww / 2, wy, 0.04, false));
    win.add(box(0.08, wh, 0.12, frameMat, ww / 2, wy, 0.04, false));
    win.add(box(0.05, wh, 0.06, frameMat, 0, wy, 0.03, false));
    win.add(box(ww, 0.05, 0.06, frameMat, 0, wy + 0.35, 0.03, false));
    win.position.set(-W / 2 + 0.03, 0, z);
    win.rotation.y = Math.PI / 2;
    g.add(win);
  }

  /* ---------- the board ---------- */
  const B = lay.board;
  const boardFrame = box(B.w + 0.22, B.h + 0.22, 0.08, std({ map: T.oak('#4a3423'), roughness: 0.45 }), 0, B.y, 0.05);
  g.add(boardFrame);
  const board = new Mesh(new PlaneGeometry(B.w, B.h), new MeshBasicMaterial({ color: '#1d2b27', toneMapped: false }));
  board.position.set(0, B.y, B.z);
  g.add(board);
  g.add(box(B.w - 0.4, 0.05, 0.14, std({ color: '#6b4c33', roughness: 0.5 }), 0, B.y - B.h / 2 - 0.13, 0.12));
  // a soft wash of light over the board
  const boardLight = new PointLight('#fff1dc', 3 * (B.w / BOARD.w) ** 2, 7 * (B.w / BOARD.w), 2);
  boardLight.position.set(0, B.y + B.h / 2 + 0.6, 1.6 * (B.w / BOARD.w));
  g.add(boardLight);

  /* ---------- art on the front wall ---------- */
  const plates: [Texture, number, number, number, number][] = [
    [T.plateMaxwell(), 1.25, 1.46, -(B.w / 2 + 2.05), 3.0],
    [T.plateSpiral(), 1.3, 0.98, -(B.w / 2 + 2.05), 1.58],
    [T.plateEuler(), 1.25, 1.46, B.w / 2 + 2.05, 3.0],
    [T.plateLens(), 1.3, 0.98, B.w / 2 + 2.05, 1.58],
  ];
  for (const [art, w, h, x, y] of plates) {
    const f = framed(art, w, h, '#c9a24a', false, 0.85);
    f.position.set(x, y, 0.03);
    g.add(f);
  }

  /* ---------- paintings on the right wall, with picture lights ---------- */
  const paintings: [Texture, number, number, number, number][] = [
    [T.paintingLandscape(), 2.1, 1.4, along(4.4), 2.55],
    [T.paintingOrbits(), 1.25, 1.58, along(9.3), 2.6],
    [T.paintingSea(), 2.2, 1.32, along(13.6), 2.55],
  ];
  const brass = std({ color: '#b08d57', roughness: 0.35, metalness: 0.8 });
  for (const [art, w, h, z, y] of paintings) {
    const f = framed(art, w, h, '#b08d57', false);
    const lamp = box(w * 0.5, 0.05, 0.12, brass, 0, h / 2 + 0.2, 0.12, false);
    f.add(lamp);
    f.position.set(W / 2 - 0.03, y, z);
    f.rotation.y = -Math.PI / 2;
    g.add(f);
    const pl = new PointLight('#ffd9a6', 1.6, 2.6, 2);
    pl.position.set(W / 2 - 0.5, y + h / 2, z);
    g.add(pl);
  }

  /* ---------- back wall: a night-sky painting, bookshelves, paintings above them ---------- */
  const back = framed(T.paintingNight(), 1.5, 1.88, '#2a2119', false);
  back.position.set(0, 2.3, D - 0.03);
  back.rotation.y = Math.PI;
  g.add(back);
  for (const x of [-4.6, 4.6]) g.add(bookshelf(x, D - 0.25));
  const overShelf = framed(T.paintingPlanet(), 1.6, 1.14, '#b08d57', false);
  overShelf.position.set(4.6, 3.35, D - 0.03);
  overShelf.rotation.y = Math.PI;
  g.add(overShelf);
  const overShelf2 = framed(T.paintingBlooms(), 1.6, 1.14, '#b08d57', false);
  overShelf2.position.set(-4.6, 3.35, D - 0.03);
  overShelf2.rotation.y = Math.PI;
  g.add(overShelf2);
  // Two colourful paintings either side of the night sky.
  for (const [art, x] of [[T.paintingBalloons(), -2.25], [T.paintingRainbow(), 2.25]] as const) {
    const f = framed(art, 1.3, 1.62, '#b08d57', false);
    f.position.set(x, 2.25, D - 0.03);
    f.rotation.y = Math.PI;
    g.add(f);
  }
  // An inscription across the top of the back wall.
  const words = new Mesh(
    new PlaneGeometry(7.6, 0.82),
    new MeshBasicMaterial({ map: T.inscription(...INSCRIPTION), transparent: true }),
  );
  words.position.set(0, 3.98, D - 0.02);
  words.rotation.y = Math.PI;
  g.add(words);

  /* ---------- quotations from scientists, between the windows and the paintings ---------- */
  // [quote, author, note] with where each hangs: [wall x, z]
  // Left wall: between the first two windows and the last two.
  const winZ = (i: number) => 3.6 + (i * (D - 7.2)) / (windows - 1);
  const spots: [number, number][] = [
    [-W / 2 + 0.03, (winZ(0) + winZ(1)) / 2],
    [-W / 2 + 0.03, (winZ(windows - 2) + winZ(windows - 1)) / 2],
    [W / 2 - 0.03, along(6.95)],
    [W / 2 - 0.03, along(11.25)],
  ];
  const quotes = QUOTES.map(([q, a, n], i) => [q, a, n, spots[i][0], spots[i][1]] as const);
  for (const [q, a, n, x, z] of quotes) {
    const f = framed(T.quotePlate(q, a, n), 1.85, 1.27, '#c9a24a', false, 0.85);
    f.position.set(x, 2.55, z);
    f.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(f);
  }

  /* ---------- clock on the right wall ---------- */
  const clock = new Group();
  const face = new Mesh(new CircleGeometry(0.32, 48), std({ map: T.clockFace(), roughness: 0.6 }));
  const rim = new Mesh(new CylinderGeometry(0.345, 0.345, 0.05, 48, 1, true), std({ color: '#2a2119', roughness: 0.4, side: DoubleSide }));
  rim.rotation.x = Math.PI / 2;
  const handMat = std({ color: '#1d1712' });
  const hour = new Mesh(new BoxGeometry(0.022, 0.16, 0.01), handMat);
  hour.geometry.translate(0, 0.07, 0);
  const minute = new Mesh(new BoxGeometry(0.014, 0.25, 0.01), handMat);
  minute.geometry.translate(0, 0.11, 0);
  hour.position.z = minute.position.z = 0.012;
  clock.add(face, rim, hour, minute);
  clock.position.set(W / 2 - 0.04, 3.55, 1.8);
  clock.rotation.y = -Math.PI / 2;
  g.add(clock);
  const tickClock = () => {
    const d = new Date();
    const m = d.getMinutes() + d.getSeconds() / 60;
    minute.rotation.z = -(m / 60) * Math.PI * 2;
    hour.rotation.z = -(((d.getHours() % 12) + m / 60) / 12) * Math.PI * 2;
  };
  tickClock();

  /* ---------- plants ---------- */
  for (const [x, z, s] of [[-W / 2 + 0.8, 0.7, 1.15], [W / 2 - 0.8, 0.7, 1.15], [-W / 2 + 0.8, D - 0.8, 1], [W / 2 - 0.7, along(6.9), 0.9]] as const) {
    g.add(plant(x, z, s));
  }

  /* ---------- teacher's desk ---------- */
  const deskOak = std({ map: T.oak('#8a643f'), roughness: 0.5 });
  const steel = std({ color: '#2b2b2e', roughness: 0.4, metalness: 0.7 });
  const tDesk = new Group();
  tDesk.add(box(1.9, 0.05, 0.85, deskOak, 0, 0.76, 0));
  tDesk.add(box(1.86, 0.62, 0.03, deskOak, 0, 0.42, -0.38));
  for (const sx of [-0.9, 0.9]) tDesk.add(box(0.05, 0.74, 0.8, steel, sx, 0.37, 0));
  tDesk.add(box(0.36, 0.02, 0.25, std({ color: '#1c1c1f', metalness: 0.5, roughness: 0.3 }), 0.4, 0.795, 0.05));
  tDesk.add(box(0.36, 0.23, 0.015, std({ color: '#1c1c1f', metalness: 0.5, roughness: 0.3 }), 0.4, 0.92, -0.08));
  tDesk.add(box(0.28, 0.06, 0.2, std({ color: '#7a2e2e' }), -0.5, 0.81, 0.02));
  tDesk.add(box(0.26, 0.05, 0.19, std({ color: '#264b6b' }), -0.5, 0.865, 0.02));
  tDesk.position.set(Math.max(4.3, B.w / 2 + 1.5), 0, 2.0 + (B.w - BOARD.w) * 0.15);
  tDesk.rotation.y = -0.18;
  g.add(tDesk);

  /* ---------- student desks and chairs (instanced: one draw call each) ---------- */
  // First come, first seated: front row first, filling from the centre outwards.
  const cols = lay.xs;
  const rows = lay.zs;
  const seats: Vector3[] = [];
  for (const z of rows) for (const x of cols) seats.push(new Vector3(x, 0.47, z + 0.62));
  const n = seats.length;
  const parts: [BoxGeometry, MeshStandardMaterial, (i: number, m: Matrix4) => void][] = [];
  const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
  const topGeo = new BoxGeometry(1.2, 0.04, 0.62);
  parts.push([topGeo, deskOak, (i, m) => m.copy(at(seats[i].x, 0.74, seats[i].z - 0.62))]);
  const legGeo = new BoxGeometry(0.04, 0.72, 0.56);
  parts.push([legGeo, steel, (i, m) => m.copy(at(seats[i].x - 0.56, 0.36, seats[i].z - 0.62))]);
  parts.push([legGeo, steel, (i, m) => m.copy(at(seats[i].x + 0.56, 0.36, seats[i].z - 0.62))]);
  const fabric = std({ color: '#3c4a5c', roughness: 0.85 });
  parts.push([new BoxGeometry(0.46, 0.05, 0.44), fabric, (i, m) => m.copy(at(seats[i].x, 0.46, seats[i].z))]);
  parts.push([new BoxGeometry(0.46, 0.42, 0.04), fabric, (i, m) => m.copy(at(seats[i].x, 0.72, seats[i].z + 0.22))]);
  const chairLeg = new BoxGeometry(0.03, 0.44, 0.03);
  for (const [dx, dz] of [[-0.2, -0.19], [0.2, -0.19], [-0.2, 0.19], [0.2, 0.19]]) {
    parts.push([chairLeg, steel, (i, m) => m.copy(at(seats[i].x + dx, 0.22, seats[i].z + dz))]);
  }
  const m4 = new Matrix4();
  for (const [geo, mat, place] of parts) {
    const inst = new InstancedMesh(geo, mat, n);
    for (let i = 0; i < n; i++) {
      place(i, m4);
      inst.setMatrixAt(i, m4);
    }
    inst.castShadow = n <= 64;
    inst.receiveShadow = true;
    g.add(inst);
  }

  /* ---------- light ---------- */
  const hemi = new HemisphereLight('#fff8ec', '#8a6f55', 1.45);
  g.add(hemi);
  const sun = new DirectionalLight('#fff0d8', 2.1);
  sun.position.set(-9, 7, 6);
  sun.target.position.set(1, 0, 7);
  g.add(sun, sun.target);
  if (opts.shadows) {
    sun.castShadow = true;
    const reach = Math.max(10, W / 2 + 1, D / 2 + 1);
    sun.shadow.mapSize.set(reach > 12 ? 2048 : 1024, reach > 12 ? 2048 : 1024);
    const c = sun.shadow.camera;
    c.left = -reach;
    c.right = reach;
    c.top = reach;
    c.bottom = -reach;
    c.near = 1;
    c.far = 30 + reach * 2;
    sun.position.set(-9 - (W - ROOM.W) / 2, 7 + (H - ROOM.H), 6 + (D - ROOM.D) / 2);
    sun.target.position.set(1, 0, D / 2 - 1);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  // recessed ceiling panels (they glow; two warm fills do the lighting)
  const glow = new MeshBasicMaterial({ color: new Color('#fff6e6'), toneMapped: false });
  const px = Math.max(1, Math.round(W / 9));
  const pz = Math.max(3, Math.round(D / 4.6));
  for (let ix = -px; ix <= px; ix++) {
    const x = ix * 3.6;
    if (Math.abs(x) > W / 2 - 1.2) continue;
    for (let iz = 0; iz < pz; iz++) {
      const z = 3.5 + (iz * (D - 7)) / (pz - 1);
      const p = new Mesh(new PlaneGeometry(1.3, 1.3), glow);
      p.rotation.x = Math.PI / 2;
      p.position.set(x, H - 0.01, z);
      g.add(p);
    }
  }
  // Two warm fills; in a big hall they reach further (the number of lights stays the same).
  const big = D / ROOM.D;
  for (const z of [4 * big, 11 * big]) {
    const l = new PointLight('#ffeacc', 7 * Math.min(2.2, big * big), 14 * big, 1.6);
    l.position.set(0, H - 0.4, z);
    g.add(l);
  }
  if (big > 1) hemi.intensity = 1.45 + Math.min(0.5, (big - 1) * 0.35);

  return { group: g, board, seats, teacherSpot: new Vector3(-Math.max(3.55, B.w / 2 + 0.75), 0, 1.35 + (B.w - BOARD.w) * 0.1), tickClock, sun, dims: { W, D, H, board: B } };
}

/* ---------- furniture helpers ---------- */

function bookshelf(x: number, z: number): Group {
  const g = new Group();
  const wood = std({ map: T.oak('#6b4a30'), roughness: 0.55 });
  const w = 2.4, h = 2.3, d = 0.38;
  g.add(box(w, h, 0.03, wood, 0, h / 2, -d / 2 + 0.015));
  for (const sx of [-w / 2, w / 2]) g.add(box(0.04, h, d, wood, sx, h / 2, 0));
  const shelves = [0.05, 0.6, 1.15, 1.7, h - 0.02];
  for (const y of shelves) g.add(box(w, 0.035, d, wood, 0, y, 0));
  const colors = ['#6e3b2e', '#2e4057', '#8c6a3f', '#3f5a45', '#a0855b', '#4b3b5c', '#7a2e2e', '#2e4a57', '#c9b79a', '#54453a'];
  const book = new BoxGeometry(1, 1, 1);
  let seed = Math.abs(Math.round(x * 13));
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const mats = colors.map((c) => std({ color: c, roughness: 0.8 }));
  for (let s = 0; s < shelves.length - 1; s++) {
    let bx = -w / 2 + 0.06;
    while (bx < w / 2 - 0.12) {
      const bw = 0.035 + rand() * 0.04;
      const bh = 0.32 + rand() * 0.16;
      if (rand() < 0.08) {
        bx += 0.18;
        continue;
      }
      const b = new Mesh(book, mats[Math.floor(rand() * mats.length)]);
      b.scale.set(bw, bh, 0.24);
      b.position.set(bx + bw / 2, shelves[s] + 0.02 + bh / 2, 0.02);
      b.castShadow = true;
      g.add(b);
      bx += bw + 0.004;
    }
  }
  g.position.set(x, 0, z);
  g.rotation.y = Math.PI;
  return g;
}

function plant(x: number, z: number, s: number): Group {
  const g = new Group();
  const pot = new Mesh(new CylinderGeometry(0.26, 0.2, 0.55, 28), std({ color: '#e3dbcf', roughness: 0.5 }));
  pot.position.y = 0.275;
  pot.castShadow = true;
  g.add(pot);
  const soil = new Mesh(new CircleGeometry(0.24, 24), std({ color: '#3a2a1e' }));
  soil.rotation.x = -Math.PI / 2;
  soil.position.y = 0.53;
  g.add(soil);
  const leafGeo = new SphereGeometry(1, 10, 12);
  const greens = ['#2f5a37', '#3d6b41', '#4a7b4a', '#2a4d30'].map((c) => std({ color: c, roughness: 0.7 }));
  const dummy = new Object3D();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.4;
    const tilt = 0.12 + (i % 4) * 0.08;
    const len = 0.55 + ((i * 37) % 10) / 22;
    const leaf = new Mesh(leafGeo, greens[i % greens.length]);
    dummy.position.set(Math.cos(a) * 0.08, 0.55 + len, Math.sin(a) * 0.08);
    dummy.rotation.set(Math.sin(a) * tilt, 0, Math.cos(a) * tilt);
    dummy.scale.set(0.05, len, 0.016);
    leaf.position.copy(dummy.position);
    leaf.rotation.copy(dummy.rotation);
    leaf.rotateY(a);
    leaf.scale.copy(dummy.scale);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  return g;
}
