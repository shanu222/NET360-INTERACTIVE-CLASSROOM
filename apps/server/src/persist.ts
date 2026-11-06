import { gunzipSync, gzipSync } from 'node:zlib';
import type { BoardState } from '@net360/protocol';
import { config, dbEnabled } from './config.ts';
import { query, write } from './db.ts';
import { store, type Session } from './store.ts';

/** D1 stores values up to 2 MB; stay safely under it. */
const MAX_SNAPSHOT_BYTES = 1_900_000;

/** Board → gzip → base64. Points are rounded to 0.01 board units (well below a pixel). */
export function encodeBoard(b: BoardState): string {
  const slim: BoardState = {
    ...b,
    strokes: Object.fromEntries(
      Object.entries(b.strokes).map(([id, s]) => [id, { ...s, pts: s.pts.map((n) => Math.round(n * 100) / 100) }]),
    ),
  };
  return gzipSync(JSON.stringify(slim), { level: 6 }).toString('base64');
}

export function decodeBoard(data: string): BoardState {
  return JSON.parse(gunzipSync(Buffer.from(data, 'base64')).toString('utf8')) as BoardState;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export const persist = {
  sessionCreated(s: Session) {
    const i = s.info;
    write(
      `INSERT INTO class_sessions (id, code, subject, topic, teacher_uid, teacher_name, board_key, status, started_at, last_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'live', ?, ?)`,
      [i.id, i.code, i.subject, i.topic, s.teacherUid, i.teacherName, s.boardKey, i.startedAt, Date.now()],
    );
  },

  joined(s: Session, uid: string, name: string, role: 'teacher' | 'student') {
    const now = Date.now();
    write(
      `INSERT INTO session_participants (session_id, user_id, name, role, joined_at, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id, user_id) DO UPDATE SET last_seen = excluded.last_seen, name = excluded.name`,
      [s.info.id, uid, name, role, now, now],
    );
  },

  left(s: Session, uid: string) {
    write(`UPDATE session_participants SET last_seen = ? WHERE session_id = ? AND user_id = ?`, [Date.now(), s.info.id, uid]);
  },

  handRaised(s: Session, uid: string) {
    write(`INSERT INTO hand_raises (session_id, user_id, raised_at) VALUES (?, ?, ?)`, [s.info.id, uid, Date.now()]);
  },

  handLowered(s: Session, uid: string, by: 'student' | 'teacher') {
    write(
      `UPDATE hand_raises SET lowered_at = ?, lowered_by = ? WHERE session_id = ? AND user_id = ? AND lowered_at IS NULL`,
      [Date.now(), by, s.info.id, uid],
    );
  },

  /** The board changed; it will be snapshotted on the next tick. */
  boardChanged(s: Session) {
    if (dbEnabled) dirty.add(s.info.id);
  },

  async ended(s: Session) {
    await snapshot(s);
    write(`UPDATE class_sessions SET status = 'ended', ended_at = ?, last_active = ? WHERE id = ?`, [Date.now(), Date.now(), s.info.id]);
  },
};

/* ------------------------------------------------------------------ */
/* Board snapshots                                                     */
/* ------------------------------------------------------------------ */

const dirty = new Set<string>();

async function snapshot(s: Session) {
  if (!dbEnabled) return;
  dirty.delete(s.info.id);
  const data = encodeBoard(s.board);
  if (data.length > MAX_SNAPSHOT_BYTES) {
    console.warn(`[db] snapshot for ${s.info.code} is ${data.length} bytes — too large for D1, skipped`);
    return;
  }
  const now = Date.now();
  try {
    await query(
      `INSERT INTO board_snapshots (session_id, seq, pages, strokes, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (session_id) DO UPDATE SET seq = excluded.seq, pages = excluded.pages, strokes = excluded.strokes,
         data = excluded.data, updated_at = excluded.updated_at`,
      [s.info.id, s.board.seq, s.board.pages, s.board.order.length, data, now],
    );
    await query(`UPDATE class_sessions SET last_active = ? WHERE id = ?`, [now, s.info.id]);
  } catch (e) {
    dirty.add(s.info.id); // try again next tick
    console.error('[db] snapshot failed:', (e as Error).message);
  }
}

let running = false;
async function tick() {
  if (running || !dirty.size) return;
  running = true;
  try {
    for (const id of [...dirty]) {
      const s = store.get(id);
      if (s) await snapshot(s);
      else dirty.delete(id);
    }
  } finally {
    running = false;
  }
}

/** Save every changed board now (used on shutdown). */
export async function flushAll() {
  for (const id of [...dirty]) {
    const s = store.get(id);
    if (s) await snapshot(s);
  }
}

export function startSnapshots() {
  if (!dbEnabled) return;
  setInterval(() => void tick(), config.snapshotEveryMs).unref();
}

/* ------------------------------------------------------------------ */
/* Restore after a restart                                             */
/* ------------------------------------------------------------------ */

interface Row {
  id: string;
  code: string;
  subject: string;
  topic: string;
  teacher_uid: string;
  teacher_name: string;
  board_key: string;
  started_at: number;
  data: string | null;
}

/** Bring back classes that were live when the server stopped, with their boards. */
export async function restoreLiveSessions(): Promise<number> {
  if (!dbEnabled) return 0;
  const rows = await query<Row>(
    `SELECT s.id, s.code, s.subject, s.topic, s.teacher_uid, s.teacher_name, s.board_key, s.started_at, b.data
     FROM class_sessions s LEFT JOIN board_snapshots b ON b.session_id = s.id
     WHERE s.status = 'live' AND s.last_active > ?`,
    [Date.now() - config.sessionIdleMs],
  );
  for (const r of rows) {
    let board: BoardState | undefined;
    try {
      if (r.data) board = decodeBoard(r.data);
    } catch (e) {
      console.error(`[db] could not read snapshot for ${r.code}:`, (e as Error).message);
    }
    store.adopt(
      {
        info: { id: r.id, code: r.code, subject: r.subject, topic: r.topic, teacherName: r.teacher_name, startedAt: r.started_at },
        teacherUid: r.teacher_uid,
        boardKey: r.board_key,
      },
      board,
    );
  }
  return rows.length;
}
