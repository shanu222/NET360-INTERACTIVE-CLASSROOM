import {
  CanvasTexture,
  CapsuleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Vector3,
} from 'three';
import { deskCard, nameTag } from './textures.ts';
import { MeshBasicMaterial, PlaneGeometry } from 'three';

export interface PersonInRoom {
  uid: string;
  name: string;
  hand: boolean;
  /** Stable seat number (join order). */
  seat: number;
}

/* Shared geometry: every person reuses the same few meshes. */
const G = {
  torso: new CapsuleGeometry(0.165, 0.3, 6, 14),
  head: new SphereGeometry(0.112, 24, 18),
  hair: new SphereGeometry(0.122, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.68),
  eye: new SphereGeometry(0.014, 10, 8),
  longHair: new CapsuleGeometry(0.1, 0.2, 4, 12),
  neck: new CylinderGeometry(0.045, 0.05, 0.08, 12),
  arm: new CapsuleGeometry(0.045, 0.3, 4, 10),
  leg: new CapsuleGeometry(0.07, 0.72, 4, 10),
};

const SKIN = ['#d9a982', '#c99470', '#b27c58', '#956142', '#74472d'];
const HAIR = ['#1b1410', '#2e1f15', '#4a3020', '#6b4a2f', '#14110e'];
const CLOTHES = ['#2f4858', '#5b3758', '#8a5a34', '#2d5a46', '#9a7a4a', '#3b4a6b', '#7a3434', '#56606e', '#6b7a55', '#c9b89a', '#e7e1d6'];

const mats = new Map<string, MeshStandardMaterial>();
const mat = (color: string, rough = 0.75) => {
  const k = `${color}:${rough}`;
  let m = mats.get(k);
  if (!m) mats.set(k, (m = new MeshStandardMaterial({ color, roughness: rough })));
  return m;
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

let glowTex: CanvasTexture | null = null;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,214,120,0.95)');
  g.addColorStop(0.35, 'rgba(242,180,76,0.45)');
  g.addColorStop(1, 'rgba(242,180,76,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new CanvasTexture(c);
  glowTex.colorSpace = SRGBColorSpace;
  return glowTex;
}

function label(text: string, accent: boolean, height = 0.15) {
  const { texture, aspect } = nameTag(text, accent);
  const s = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  s.scale.set(height * aspect, height, 1);
  s.renderOrder = 10;
  return s;
}

function look(uid: string) {
  const h = hash(uid);
  return {
    skin: SKIN[h % SKIN.length],
    hair: HAIR[(h >>> 3) % HAIR.length],
    clothes: CLOTHES[(h >>> 6) % CLOTHES.length],
    longHair: ((h >>> 9) & 1) === 1,
  };
}

/** Two small eyes on the face; `dir` is the way the face looks (−1 = −z). */
function eyes(headY: number, dir: 1 | -1, scale = 1) {
  const g = new Group();
  for (const x of [-0.038, 0.038]) {
    const e = new Mesh(G.eye, mat('#1a1410', 0.4));
    e.position.set(x * scale, headY + 0.012 * scale, dir * 0.1 * scale);
    g.add(e);
  }
  return g;
}

const CARD = new PlaneGeometry(0.34, 0.106);

/** "Ali Raza" → "Ali R." — short enough for a desk card. */
function cardName(full: string) {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

/**
 * A folded name card on the front of the desk: one face toward the board
 * (the teacher reads it), one toward the student behind.
 */
const cardMats = new Map<string, MeshBasicMaterial>();
function nameCard(name: string): Group {
  const label = cardName(name);
  let mat = cardMats.get(label);
  if (!mat) cardMats.set(label, (mat = new MeshBasicMaterial({ map: deskCard(label) })));
  const g = new Group();
  const front = new Mesh(CARD, mat);
  front.rotation.set(-0.32, Math.PI, 0); // faces the board, leaning back
  front.position.set(0, 0, -0.016);
  const back = new Mesh(CARD, mat);
  back.rotation.set(-0.32, 0, 0);
  back.position.set(0, 0, 0.016);
  g.add(front, back);
  // On the desk top (desk at seat.z − 0.62, top at 0.76 m), near its front edge.
  g.position.set(0.28, 0.76 + 0.05 - 0.47, -0.62 - 0.17);
  return g;
}

/** A seated student, facing the board (−z). */
function seated(uid: string, hand: boolean): Group {
  const l = look(uid);
  const g = new Group();
  const torso = new Mesh(G.torso, mat(l.clothes));
  torso.scale.set(1.12, 1, 0.72);
  torso.position.set(0, 0.34, 0);
  const neck = new Mesh(G.neck, mat(l.skin, 0.6));
  neck.position.y = 0.66;
  const head = new Mesh(G.head, mat(l.skin, 0.7));
  head.position.y = 0.79;
  const hair = new Mesh(G.hair, mat(l.hair, 0.65));
  hair.position.set(0, 0.805, 0.015);
  hair.rotation.x = 0.42;
  g.add(torso, neck, head, hair, eyes(0.79, -1));
  if (l.longHair) {
    const back = new Mesh(G.longHair, mat(l.hair, 0.9));
    back.position.set(0, 0.68, 0.07);
    back.scale.set(1.1, 1, 0.6);
    g.add(back);
  }
  // Arms resting forward on the desk; the right one goes up for a raised hand.
  const left = new Mesh(G.arm, mat(l.clothes));
  left.position.set(-0.2, 0.36, -0.14);
  left.rotation.x = 1.15;
  g.add(left);
  const right = new Mesh(G.arm, mat(l.clothes));
  if (hand) {
    right.position.set(0.21, 0.82, -0.02);
    right.rotation.z = -0.12;
    const palm = new Mesh(G.head, mat(l.skin, 0.6));
    palm.scale.setScalar(0.42);
    palm.position.set(0.235, 1.03, -0.02);
    const halo = new Sprite(new SpriteMaterial({ map: glow(), transparent: true, depthWrite: false }));
    halo.scale.set(0.5, 0.5, 1);
    halo.position.set(0.235, 1.05, 0);
    g.add(palm, halo);
  } else {
    right.position.set(0.2, 0.36, -0.14);
    right.rotation.x = 1.15;
  }
  g.add(right);
  g.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
  });
  return g;
}

/** The teacher, standing beside the board, facing the class (+z). */
function standing(uid: string): Group {
  const l = look(uid);
  const g = new Group();
  const suit = mat('#34405a', 0.7);
  for (const x of [-0.1, 0.1]) {
    const leg = new Mesh(G.leg, mat('#23262e', 0.8));
    leg.position.set(x, 0.43, 0);
    g.add(leg);
  }
  const torso = new Mesh(G.torso, suit);
  torso.scale.set(1.25, 1.18, 0.78);
  torso.position.y = 1.2;
  const neck = new Mesh(G.neck, mat(l.skin, 0.6));
  neck.position.y = 1.57;
  const head = new Mesh(G.head, mat(l.skin, 0.7));
  head.scale.setScalar(1.05);
  head.position.y = 1.71;
  const hair = new Mesh(G.hair, mat('#1b1410', 0.65));
  hair.scale.setScalar(1.05);
  hair.position.set(0, 1.728, -0.016);
  hair.rotation.x = -0.42;
  // shirt and tie under the jacket
  const shirt = new Mesh(new CapsuleGeometry(0.06, 0.16, 4, 8), mat('#efe9df', 0.8));
  shirt.position.set(0, 1.38, 0.115);
  shirt.scale.set(1, 1, 0.5);
  const tie = new Mesh(new CapsuleGeometry(0.018, 0.16, 4, 8), mat('#7a2e2e', 0.6));
  tie.position.set(0, 1.35, 0.135);
  g.add(torso, neck, head, hair, shirt, tie, eyes(1.71, 1, 1.05));
  const armL = new Mesh(G.arm, suit);
  armL.position.set(-0.25, 1.15, 0);
  armL.rotation.z = 0.12;
  // right arm gestures toward the board
  const armR = new Mesh(G.arm, suit);
  armR.position.set(0.3, 1.3, 0.05);
  armR.rotation.set(-0.3, 0, -1.0);
  g.add(armL, armR);
  g.traverse((o) => {
    if ((o as Mesh).isMesh) (o as Mesh).castShadow = true;
  });
  return g;
}

/**
 * Everyone in the room. Students take seats in join order; the teacher stands
 * at the front. Avatars are rebuilt only when someone's hand changes.
 */
export class PeopleLayer {
  readonly group = new Group();
  private avatars = new Map<string, { g: Group; hand: boolean; name: string }>();
  private teacher: Group | null = null;
  private teacherKey = '';
  showNames = false;

  constructor(
    private seats: Vector3[],
    private teacherSpot: Vector3,
  ) {}

  setTeacher(name: string | null) {
    const key = name ?? '';
    if (key === this.teacherKey) return;
    this.teacherKey = key;
    if (this.teacher) this.group.remove(this.teacher);
    this.teacher = null;
    if (!name) return;
    const t = standing(`teacher:${name}`);
    t.position.copy(this.teacherSpot);
    t.rotation.y = 0.55;
    const tag = label(name, false, 0.17);
    tag.position.set(0, 2.05, 0);
    tag.visible = this.showNames;
    tag.name = 'tag';
    t.add(tag);
    this.teacher = t;
    this.group.add(t);
  }

  update(people: PersonInRoom[], hideUid?: string) {
    const keep = new Set<string>();
    for (const p of people) {
      if (p.uid === hideUid) continue;
      const seat = this.seats[p.seat % this.seats.length];
      if (!seat) continue;
      keep.add(p.uid);
      const cur = this.avatars.get(p.uid);
      if (cur && cur.hand === p.hand && cur.name === p.name) continue;
      if (cur) this.group.remove(cur.g);
      const g = seated(p.uid, p.hand);
      g.add(nameCard(p.name));
      g.position.copy(seat);
      const tag = label(p.name.split(' ')[0], p.hand);
      tag.position.set(0, p.hand ? 1.32 : 1.08, 0);
      tag.name = 'tag';
      tag.visible = this.showNames;
      g.add(tag);
      this.group.add(g);
      this.avatars.set(p.uid, { g, hand: p.hand, name: p.name });
    }
    for (const [uid, a] of this.avatars) {
      if (!keep.has(uid)) {
        this.group.remove(a.g);
        this.avatars.delete(uid);
      }
    }
  }

  setShowNames(show: boolean) {
    this.showNames = show;
    for (const { g } of this.avatars.values()) {
      const t = g.getObjectByName('tag');
      if (t) t.visible = show;
    }
    const tt = this.teacher?.getObjectByName('tag');
    if (tt) tt.visible = show;
  }
}
