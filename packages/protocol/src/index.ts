/**
 * Meeto360 — shared real-time protocol.
 *
 * The board is never sent as images or video. Every change is a small event;
 * the server stamps each one with a sequence number, and every client folds
 * the same ordered events into the same board state with `applyEvent`.
 */

/* ------------------------------------------------------------------ */
/* Board geometry                                                      */
/* ------------------------------------------------------------------ */

/** Logical board size. Every device scales this page to fit its screen. */
export const BOARD_W = 1600;
export const BOARD_H = 900;
/** Coordinates travel as integers in quarter units (sub-pixel precision for tablets). */
export const COORD_SCALE = 4;

export type Role = 'teacher' | 'student' | 'board';

export type Tool = 'pen' | 'highlighter' | 'line' | 'arrow' | 'rect' | 'circle';
export const SHAPE_TOOLS: Tool[] = ['line', 'arrow', 'rect', 'circle'];

export interface StrokeStyle {
  tool: Tool;
  /** CSS colour. */
  c: string;
  /** Base width in board units. */
  w: number;
  /** True when the input device had no real pressure (mouse/touch) — renderer simulates it. */
  sim?: boolean;
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

/**
 * Stroke points are a flat array of [x, y, pressure] triples:
 *  - in `StrokeStart` they are absolute (x, y in quarter units; pressure 0–255),
 *  - in `StrokePoints` x and y are deltas from the previous point.
 */
export interface StrokeStart { t: 's'; id: string; pg: number; st: StrokeStyle; p: number[] }
export interface StrokePoints { t: 'p'; id: string; p: number[]; /** ms since the stroke started */ d: number }
export interface StrokeEnd { t: 'e'; id: string }
/** Hide strokes — used by undo, the eraser and "clear page". Reversible. */
export interface StrokeHide { t: 'h'; ids: string[] }
/** Show hidden strokes again — used by redo. */
export interface StrokeShow { t: 'u'; ids: string[] }
export interface PageNew { t: 'pn' }
export interface PageGo { t: 'pg'; pg: number }
/**
 * Add slides: each image becomes the background of a new page (in order), and the
 * class moves to the first one. Images are `<sessionId>/<id>.jpg` (see slideUrl).
 */
export interface SlidesAdd { t: 'sl'; imgs: string[] }

/**
 * What the class is looking at:
 *  - board  — the whiteboard (pages without a slide)
 *  - slides — the presentation (pages with a slide), written on directly
 *  - split  — the current slide and the whiteboard side by side
 */
export type BoardMode = 'board' | 'slides' | 'split';
export const BOARD_MODES: BoardMode[] = ['board', 'slides', 'split'];
export interface ModeSet { t: 'md'; m: BoardMode }

export type BoardEventBody = StrokeStart | StrokePoints | StrokeEnd | StrokeHide | StrokeShow | PageNew | PageGo | SlidesAdd | ModeSet;

/** A slide image reference: `<sessionId>/<id>.jpg`. */
export const SLIDE_RE = /^[A-Za-z0-9_-]{6,40}\/[A-Za-z0-9_-]{6,40}\.jpg$/;
/** Most slides one deck may add at once. */
export const MAX_SLIDES = 80;

/** An event as broadcast by the server: body + order + origin. */
export type BoardEvent = BoardEventBody & {
  /** Sequence number assigned by the server. */
  seq: number;
  /** Client id that produced it (lets the author skip its own echo). */
  o: string;
  /** Server receive time, ms epoch. */
  at: number;
};

/* ------------------------------------------------------------------ */
/* Board state                                                         */
/* ------------------------------------------------------------------ */

export interface Stroke {
  id: string;
  pg: number;
  st: StrokeStyle;
  /** Absolute points: [x, y, pressure 0..1] triples in board units. */
  pts: number[];
  done: boolean;
  hidden: boolean;
  /** Bumped on every change so renderers can cache. */
  v: number;
}

export interface BoardState {
  seq: number;
  pages: number;
  page: number;
  /** Insertion-ordered stroke ids (draw order). */
  order: string[];
  strokes: Record<string, Stroke>;
  /** Slide shown behind a page's writing (page → image). Missing on older saved boards. */
  bg?: Record<number, string>;
  /** What the class is looking at (missing on older boards: worked out from `page`). */
  mode?: BoardMode;
  /** The current slide page (slides / split). */
  slide?: number;
  /** The current whiteboard page (board / split). */
  wb?: number;
}

export function emptyBoard(): BoardState {
  return { seq: 0, pages: 1, page: 0, order: [], strokes: {}, bg: {}, mode: 'board', slide: -1, wb: 0 };
}

export const isSlidePage = (s: BoardState, pg: number) => Boolean(s.bg?.[pg]);

/** The board as the class sees it: which mode, and which slide and whiteboard page are up. */
export interface BoardView {
  mode: BoardMode;
  /** Current slide page, or null when there are no slides. */
  slide: number | null;
  /** Current whiteboard page, or null when every page is a slide. */
  wb: number | null;
  /** All slide pages, in order. */
  slides: number[];
  /** All whiteboard pages, in order. */
  boards: number[];
}

export function boardView(s: BoardState): BoardView {
  const slides: number[] = [];
  const boards: number[] = [];
  for (let p = 0; p < s.pages; p++) (isSlidePage(s, p) ? slides : boards).push(p);
  const slide =
    s.slide !== undefined && s.slide >= 0 && isSlidePage(s, s.slide) && s.slide < s.pages
      ? s.slide
      : isSlidePage(s, s.page)
        ? s.page
        : (slides[0] ?? null);
  const wb =
    s.wb !== undefined && s.wb >= 0 && s.wb < s.pages && !isSlidePage(s, s.wb)
      ? s.wb
      : !isSlidePage(s, s.page)
        ? s.page
        : (boards[0] ?? null);
  let mode: BoardMode = s.mode ?? (isSlidePage(s, s.page) ? 'slides' : 'board');
  if (mode !== 'board' && slide === null) mode = 'board';
  if (mode === 'split' && wb === null) mode = 'slides';
  if (mode === 'board' && wb === null) mode = 'slides';
  return { mode, slide, wb, slides, boards };
}

/** Add a whiteboard page at the end and make it current. */
function addBoardPage(s: BoardState) {
  s.pages += 1;
  s.wb = s.pages - 1;
  return s.wb;
}

/** Result of applying an event: which pages changed and whether only a live stroke grew. */
export interface ApplyResult {
  /** Stroke whose points grew (renderer redraws only the live layer). */
  live?: string;
  /** Something structural changed (stroke finished, hidden, page changed). */
  structural: boolean;
}

/** Decode absolute quantized triples into board-unit triples, appending to `out`. */
function decodeAbs(p: number[], out: number[]) {
  for (let i = 0; i + 2 < p.length; i += 3) {
    out.push(p[i] / COORD_SCALE, p[i + 1] / COORD_SCALE, p[i + 2] / 255);
  }
}

/** Decode delta-encoded triples (relative to the last point in `out`). */
function decodeDelta(p: number[], out: number[]) {
  let x = out.length >= 3 ? Math.round(out[out.length - 3] * COORD_SCALE) : 0;
  let y = out.length >= 3 ? Math.round(out[out.length - 2] * COORD_SCALE) : 0;
  for (let i = 0; i + 2 < p.length; i += 3) {
    x += p[i];
    y += p[i + 1];
    out.push(x / COORD_SCALE, y / COORD_SCALE, p[i + 2] / 255);
  }
}

/** Fold one event into the board. Mutates `s` in place for speed; returns what changed. */
export function applyEvent(s: BoardState, ev: BoardEventBody & { seq?: number }): ApplyResult {
  if (ev.seq !== undefined) s.seq = Math.max(s.seq, ev.seq);
  switch (ev.t) {
    case 's': {
      if (s.strokes[ev.id]) return { structural: false };
      const pts: number[] = [];
      decodeAbs(ev.p, pts);
      s.strokes[ev.id] = { id: ev.id, pg: ev.pg, st: ev.st, pts, done: false, hidden: false, v: 1 };
      s.order.push(ev.id);
      if (ev.pg >= s.pages) s.pages = ev.pg + 1;
      return { live: ev.id, structural: false };
    }
    case 'p': {
      const st = s.strokes[ev.id];
      if (!st || st.done) return { structural: false };
      decodeDelta(ev.p, st.pts);
      st.v++;
      return { live: ev.id, structural: false };
    }
    case 'e': {
      const st = s.strokes[ev.id];
      if (!st) return { structural: false };
      st.done = true;
      st.v++;
      return { structural: true };
    }
    case 'h':
    case 'u': {
      let changed = false;
      for (const id of ev.ids) {
        const st = s.strokes[id];
        if (st && st.hidden !== (ev.t === 'h')) {
          st.hidden = ev.t === 'h';
          st.v++;
          changed = true;
        }
      }
      return { structural: changed };
    }
    case 'pn': {
      // A new whiteboard page. From the slides, this switches to the whiteboard.
      const v = boardView(s);
      s.page = addBoardPage(s);
      s.slide = v.slide ?? -1;
      s.mode = v.mode === 'split' ? 'split' : 'board';
      return { structural: true };
    }
    case 'pg': {
      if (!(ev.pg >= 0 && ev.pg < s.pages)) return { structural: false };
      const v = boardView(s);
      s.page = ev.pg;
      s.slide = v.slide ?? -1;
      s.wb = v.wb ?? -1;
      // Going to a slide shows the slides; going to a whiteboard page shows the board.
      // Side by side, each half keeps its own page.
      if (isSlidePage(s, ev.pg)) {
        s.slide = ev.pg;
        s.mode = v.mode === 'split' ? 'split' : 'slides';
      } else {
        s.wb = ev.pg;
        s.mode = v.mode === 'split' ? 'split' : 'board';
      }
      return { structural: true };
    }
    case 'sl': {
      if (!ev.imgs.length) return { structural: false };
      const v = boardView(s);
      const bg = (s.bg ??= {});
      // A completely blank board starts the deck on page 1; otherwise slides go after.
      const blank = s.pages === 1 && !s.order.some((id) => !s.strokes[id]?.hidden) && !bg[0];
      const first = blank ? 0 : s.pages;
      ev.imgs.forEach((img, i) => (bg[first + i] = img));
      s.pages = first + ev.imgs.length;
      s.page = first;
      s.slide = first;
      s.wb = blank ? -1 : (v.wb ?? -1);
      // New slides come straight up for everyone.
      s.mode = v.mode === 'split' && !blank ? 'split' : 'slides';
      return { structural: true };
    }
    case 'md': {
      const v = boardView(s);
      if (!BOARD_MODES.includes(ev.m) || ev.m === v.mode) return { structural: false };
      if (ev.m !== 'board' && v.slide === null) return { structural: false }; // no slides yet
      const wb = ev.m !== 'slides' && v.wb === null ? addBoardPage(s) : v.wb;
      s.slide = v.slide ?? -1;
      s.wb = wb ?? -1;
      s.mode = ev.m;
      // The pen writes on what is in front: the whiteboard, the slide — side by side,
      // wherever it was last.
      if (ev.m === 'board') s.page = wb!;
      else if (ev.m === 'slides') s.page = v.slide!;
      else if (s.page !== v.slide && s.page !== wb) s.page = wb!;
      return { structural: true };
    }
  }
}

/** Quantize board-unit points for transmission. */
export function encodeAbs(x: number, y: number, pressure: number): [number, number, number] {
  return [Math.round(x * COORD_SCALE), Math.round(y * COORD_SCALE), Math.max(0, Math.min(255, Math.round(pressure * 255)))];
}

/** Visible strokes on a page, in draw order. */
export function pageStrokes(s: BoardState, pg: number): Stroke[] {
  const out: Stroke[] = [];
  for (const id of s.order) {
    const st = s.strokes[id];
    if (st && st.pg === pg && !st.hidden) out.push(st);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Class state & socket messages                                       */
/* ------------------------------------------------------------------ */

export interface SessionInfo {
  id: string;
  code: string;
  subject: string;
  topic: string;
  teacherName: string;
  startedAt: number;
  /** How many students the teacher expects (sets the size of the classroom). */
  size?: number;
}

/** Class sizes a teacher can choose when starting a class. */
export const CLASS_SIZES = [40, 60, 150, 300, 500] as const;
/** Most students one class can hold. */
export const MAX_CLASS = 500;
/** The class size to plan for: the teacher's choice, or more if more have come. */
export function classSize(chosen: number | undefined, seated = 0): number {
  const want = Math.max(chosen ?? CLASS_SIZES[0], seated);
  return CLASS_SIZES.find((n) => n >= want) ?? MAX_CLASS;
}

export interface ClassState {
  /** Board display shows the join QR/code overlay. */
  showJoin: boolean;
  /** Students currently connected. */
  present: number;
  live: boolean;
}

export interface RosterEntry {
  uid: string;
  name: string;
  online: boolean;
  hand: boolean;
  /** When the hand went up, for queue order. */
  handAt?: number;
  joinedAt: number;
  seat: number;
}

export interface Me { uid: string; name: string; clientId: string }

/** A private message between the teacher and one student. */
export interface ChatMessage {
  id: string;
  /** Sender uid. */
  from: string;
  fromName: string;
  /** Receiver uid (the teacher's uid, or a student's). */
  to: string;
  text: string;
  at: number;
  /** The sender's own temporary id, so their screen can swap the pending copy for this one. */
  cid?: string;
}

/** `by` has read the conversation with `peer` up to `at`. */
export interface ChatSeen { by: string; peer: string; at: number }

/**
 * Class audio. The teacher is always heard; students speak only when the teacher
 * allows it (one by one, or everyone). The server enforces this in the media room.
 */
export interface AudioState {
  /** Class audio is set up on this server. */
  available: boolean;
  /** Everyone may switch their own microphone on (except `blocked`). */
  open: boolean;
  /** Students the teacher has invited to speak. */
  allowed: string[];
  /** Students the teacher has muted (even while everyone may speak). */
  blocked: string[];
}

export function canSpeak(a: AudioState, uid: string): boolean {
  return !a.blocked.includes(uid) && (a.open || a.allowed.includes(uid));
}

/** What every screen knows about the people in class (for the 3D room). */
export interface PersonPublic {
  uid: string;
  name: string;
  hand: boolean;
  /** Stable seat number, in join order. */
  seat: number;
}

export interface Welcome {
  role: Role;
  me: Me;
  session: SessionInfo;
  cls: ClassState;
  /** Whether this client may write on the board right now. */
  canWrite: boolean;
  /** Changes whenever the server restarts; clients then take a fresh snapshot. */
  epoch: string;
}

/** Server → client */
export interface ServerToClient {
  welcome: (w: Welcome) => void;
  /** Full board state (late join or long disconnect). */
  snap: (s: BoardState) => void;
  /** Missed events since the client's last seq (short disconnect). */
  tail: (evs: BoardEvent[]) => void;
  b: (ev: BoardEvent) => void;
  cls: (c: ClassState) => void;
  /** Teacher only. */
  roster: (r: RosterEntry[]) => void;
  /** Everyone: who is in the room right now. */
  people: (p: PersonPublic[]) => void;
  /** Student only: their own hand state. */
  hand: (up: boolean) => void;
  ended: () => void;
  fail: (msg: string) => void;
  /** A private message for this user (teacher: any student's; student: their own thread). */
  chat: (m: ChatMessage) => void;
  /** Earlier messages, sent once after connecting. */
  chatHistory: (m: ChatMessage[]) => void;
  /** Read receipts (sent with history too). */
  chatSeen: (s: ChatSeen[]) => void;
  /** The other person is typing. */
  typing: (from: string) => void;
  /** Who may speak right now. */
  audio: (a: AudioState) => void;
  /** Student: the teacher has just muted you. */
  mutedByTeacher: () => void;
  /** Who may present right now. */
  present: (p: PresentState) => void;
  /** Student: the teacher said not now. */
  presentDeclined: () => void;
}

/** Client → server */
export interface ClientToServer {
  b: (ev: BoardEventBody) => void;
  sync: (lastSeq: number) => void;
  hand: (up: boolean) => void;
  /** Teacher: lower a student's hand. */
  lower: (uid: string) => void;
  /** Teacher: update class state. */
  cls: (patch: Partial<Pick<ClassState, 'showJoin'>>) => void;
  end: () => void;
  /** Students write to the teacher; the teacher writes to one student (`to`). */
  chat: (msg: { to?: string; text: string; cid?: string }) => void;
  /** I have read my conversation with `peer` (students: omit) up to `at`. */
  chatSeen: (msg: { peer?: string; at: number }) => void;
  /** I am typing to `to` (students: omit). */
  typing: (to?: string) => void;
  /** Join the class audio: returns where to connect, with this screen's permissions. */
  mediaJoin: (ack: (r: { url: string; token: string } | { error: string }) => void) => void;
  /** Teacher: let every student switch their microphone on (true) or not (false). */
  audioOpen: (open: boolean) => void;
  /** Teacher: let one student speak, or mute them. */
  allowSpeak: (msg: { uid: string; allow: boolean }) => void;
  /** Teacher: mute every student at once. */
  muteAll: () => void;
  /** Student: ask to present (true) or withdraw / stop presenting (false). */
  presentAsk: (on: boolean) => void;
  /** Teacher: let a student present, or take it back (null). */
  presentSet: (uid: string | null) => void;
  /** Teacher: say not now to a student's request. */
  presentDecline: (uid: string) => void;
  /** Upload one slide image (JPEG). Returns its reference for a SlidesAdd event. */
  slideUpload: (data: Uint8Array, ack: (r: { img: string } | { error: string }) => void) => void;
}

export interface SocketAuth {
  sessionId: string;
  /** Firebase ID token (production). */
  idToken?: string;
  /** Dev-mode identity (only accepted when the server runs without Firebase). */
  dev?: { uid: string; name: string };
  /** Board display key (from the teacher's "open board" link). */
  boardKey?: string;
  /**
   * Which screen is connecting. The student page always joins as a student — even
   * with the teacher's own account (so one person can try both sides).
   */
  as?: 'teacher' | 'student';
  /**
   * A student joining with just a name and the class code (no sign-in).
   * `key` is a random secret kept on the student's device so they get the same
   * seat and chat back after a reload; the server never reveals it.
   */
  guest?: { key: string; name: string };
  /** The class code the student entered (required for students). */
  code?: string;
  /** Writing-pad key (teacher's phone or iPad used as a pen surface). */
  padKey?: string;
  clientId: string;
}

/** How many recent events the server keeps for fast catch-up before sending a snapshot instead. */
export const TAIL_LIMIT = 5000;

/**
 * Presenting: the teacher can always share their screen or slides; one student at a
 * time may present when the teacher allows it.
 */
export interface PresentState {
  /** Student currently allowed to present (null = only the teacher). */
  presenter: string | null;
  presenterName: string | null;
  /** Teacher only: students asking to present. */
  requests: { uid: string; name: string }[];
}

/** Six-character join code alphabet (no 0/O/1/I confusion). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
