import { customAlphabet, nanoid } from 'nanoid';
import {
  CODE_ALPHABET,
  TAIL_LIMIT,
  applyEvent,
  emptyBoard,
  type BoardEvent,
  type ChatMessage,
  type ChatSeen,
  type BoardState,
  type ClassState,
  type RosterEntry,
  type SessionInfo,
} from '@net360/protocol';
import { config } from './config.ts';

const makeCode = customAlphabet(CODE_ALPHABET, 6);

export interface Session {
  info: SessionInfo;
  teacherUid: string;
  boardKey: string;
  board: BoardState;
  /** Recent events for fast catch-up; `log[0].seq` is the oldest kept. */
  log: BoardEvent[];
  roster: Map<string, RosterEntry & { sockets: number }>;
  cls: ClassState;
  ended: boolean;
  lastActive: number;
  /** Private teacher–student messages (most recent kept in memory). */
  chats: ChatMessage[];
  /** Read receipts, keyed `${by}|${peer}`. */
  seen: Map<string, ChatSeen>;
  /** Who may speak (see AudioState). */
  audio: { open: boolean; allowed: Set<string>; blocked: Set<string> };
  /** Presenting: the student allowed to present (if any) and who's asking. */
  present: { uid: string | null; requests: Map<string, string> };
  /** Slide images uploaded in this class. */
  slides: number;
}

/**
 * In-memory session store. One process holds every live classroom — enough for
 * the MVP (dozens of rooms of 40). Persistence to Firestore and a Redis adapter
 * for multiple instances slot in behind this module later.
 */
class Store {
  private byId = new Map<string, Session>();
  private byCode = new Map<string, string>();

  create(teacher: { uid: string; name: string }, subject: string, topic: string): Session {
    let code = makeCode();
    while (this.byCode.has(code)) code = makeCode();
    const id = nanoid(12);
    const s: Session = {
      info: { id, code, subject, topic, teacherName: teacher.name, startedAt: Date.now() },
      teacherUid: teacher.uid,
      boardKey: nanoid(24),
      board: emptyBoard(),
      log: [],
      roster: new Map(),
      cls: { showJoin: true, present: 0, live: true },
      ended: false,
      lastActive: Date.now(),
      chats: [],
      seen: new Map(),
      audio: { open: false, allowed: new Set(), blocked: new Set() },
      present: { uid: null, requests: new Map() },
      slides: 0,
    };
    this.byId.set(id, s);
    this.byCode.set(code, id);
    return s;
  }

  /** Re-create a session restored from the database after a restart. */
  adopt(saved: Pick<Session, 'info' | 'teacherUid' | 'boardKey'>, board?: BoardState): Session {
    const s: Session = {
      ...saved,
      board: board ?? emptyBoard(),
      // The event log is not persisted: reconnecting clients get a snapshot (epoch changed).
      log: [],
      roster: new Map(),
      cls: { showJoin: !board || board.order.length === 0, present: 0, live: true },
      ended: false,
      lastActive: Date.now(),
      chats: [],
      seen: new Map(),
      audio: { open: false, allowed: new Set(), blocked: new Set() },
      present: { uid: null, requests: new Map() },
      slides: 0,
    };
    this.byId.set(s.info.id, s);
    this.byCode.set(s.info.code, s.info.id);
    return s;
  }

  get(id: string) {
    return this.byId.get(id);
  }

  byJoinCode(code: string) {
    const id = this.byCode.get(code.toUpperCase());
    return id ? this.byId.get(id) : undefined;
  }

  /** Stamp, apply and log one board event. */
  append(s: Session, ev: BoardEvent) {
    applyEvent(s.board, ev);
    s.log.push(ev);
    if (s.log.length > TAIL_LIMIT * 1.2) s.log.splice(0, s.log.length - TAIL_LIMIT);
    s.lastActive = Date.now();
  }

  /** Events after `lastSeq`, or null when the gap is too old (send a snapshot instead). */
  tailSince(s: Session, lastSeq: number): BoardEvent[] | null {
    if (lastSeq < 0) return null;
    if (lastSeq >= s.board.seq) return [];
    const first = s.log[0]?.seq ?? Infinity;
    if (lastSeq + 1 < first) return null;
    const idx = s.log.findIndex((e) => e.seq > lastSeq);
    return idx < 0 ? [] : s.log.slice(idx);
  }

  sweep() {
    const now = Date.now();
    for (const [id, s] of this.byId) {
      if (now - s.lastActive > config.sessionIdleMs) {
        this.byId.delete(id);
        this.byCode.delete(s.info.code);
      }
    }
  }
}

export const store = new Store();
setInterval(() => store.sweep(), 10 * 60_000).unref();
