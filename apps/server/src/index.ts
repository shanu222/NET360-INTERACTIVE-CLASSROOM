import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Server, type Socket } from 'socket.io';
import msgpackParser from 'socket.io-msgpack-parser';
import type {
  BoardEvent,
  BoardEventBody,
  ClientToServer,
  RosterEntry,
  Role,
  ServerToClient,
  SocketAuth,
  Tool,
} from '@net360/protocol';
import { authMode, config, mediaEnabled } from './config.ts';
import { mayTeach, userFromRequest, verifyUser } from './auth.ts';
import { store, type Session } from './store.ts';
import { mediaToken } from './media.ts';

const app = express();
app.use(express.json({ limit: '64kb' }));

/* ------------------------------------------------------------------ */
/* REST                                                                */
/* ------------------------------------------------------------------ */

app.get('/api/config', (_req, res) => {
  res.json({ authMode, media: mediaEnabled });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

/** Start a class. */
app.post('/api/sessions', async (req, res) => {
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to start a class.' });
  if (!mayTeach(user)) return res.status(403).json({ error: 'This account is not set up as a teacher.' });
  const subject = String(req.body?.subject ?? 'Physics').slice(0, 60);
  const topic = String(req.body?.topic ?? '').slice(0, 120);
  const s = store.create(user, subject, topic);
  res.json({ session: s.info, boardKey: s.boardKey });
});

/** Teacher re-opening their console: returns the board key again. */
app.get('/api/sessions/:id/owner', async (req, res) => {
  const user = await userFromRequest(req);
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Class not found.' });
  if (!user || user.uid !== s.teacherUid) return res.status(403).json({ error: 'Only the teacher can open this.' });
  res.json({ session: s.info, boardKey: s.boardKey });
});

/** Look up a class by its join code (shown before the student enters). */
app.get('/api/join/:code', (req, res) => {
  const s = store.byJoinCode(req.params.code);
  if (!s || s.ended) return res.status(404).json({ error: 'No live class with that code.' });
  res.json({ session: s.info, present: s.cls.present });
});

/** LiveKit token (Phase 4 media). Works with LiveKit Cloud or self-hosted. */
app.post('/api/sessions/:id/media-token', async (req, res) => {
  const user = await userFromRequest(req);
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Class not found.' });
  if (!user) return res.status(401).json({ error: 'Sign in first.' });
  const t = await mediaToken({
    sessionId: s.info.id,
    identity: user.uid,
    name: user.name,
    canPublish: user.uid === s.teacherUid,
  });
  if (!t) return res.status(503).json({ error: 'Video is not configured on this server.' });
  res.json(t);
});

/** Serve the built web app in production (single deployable). */
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: '1h', index: false }));
  app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

/* ------------------------------------------------------------------ */
/* Real-time                                                           */
/* ------------------------------------------------------------------ */

const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  parser: msgpackParser,
  cors: { origin: true, credentials: true },
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 256 * 1024,
});

const TOOLS: Tool[] = ['pen', 'highlighter', 'line', 'arrow', 'rect', 'circle'];
const isNums = (a: unknown, max = 3000): a is number[] =>
  Array.isArray(a) && a.length <= max && a.every((n) => typeof n === 'number' && Number.isFinite(n));
const isIds = (a: unknown): a is string[] =>
  Array.isArray(a) && a.length <= 5000 && a.every((x) => typeof x === 'string' && x.length <= 32);

/** Reject malformed board events before they reach every screen. */
function validEvent(ev: any): ev is BoardEventBody {
  if (!ev || typeof ev !== 'object') return false;
  switch (ev.t) {
    case 's':
      return (
        typeof ev.id === 'string' && ev.id.length <= 32 &&
        Number.isInteger(ev.pg) && ev.pg >= 0 && ev.pg < 500 &&
        ev.st && TOOLS.includes(ev.st.tool) &&
        typeof ev.st.c === 'string' && ev.st.c.length <= 32 &&
        typeof ev.st.w === 'number' && ev.st.w > 0 && ev.st.w <= 120 &&
        isNums(ev.p)
      );
    case 'p':
      return typeof ev.id === 'string' && isNums(ev.p) && typeof ev.d === 'number';
    case 'e':
      return typeof ev.id === 'string';
    case 'h':
    case 'u':
      return isIds(ev.ids);
    case 'pn':
      return true;
    case 'pg':
      return Number.isInteger(ev.pg);
    default:
      return false;
  }
}

const room = (s: Session) => `s:${s.info.id}`;
const teacherRoom = (s: Session) => `t:${s.info.id}`;
const userRoom = (s: Session, uid: string) => `u:${s.info.id}:${uid}`;

function rosterList(s: Session): RosterEntry[] {
  return [...s.roster.values()].map(({ sockets: _s, ...r }) => r);
}

function pushPresence(s: Session) {
  s.cls.present = [...s.roster.values()].filter((r) => r.online).length;
  io.to(room(s)).emit('cls', s.cls);
  io.to(teacherRoom(s)).emit('roster', rosterList(s));
}

interface SocketData {
  sessionId: string;
  role: Role;
  uid: string;
  name: string;
  clientId: string;
}

/**
 * Identify every socket BEFORE the connection handler runs, so its event
 * listeners are attached synchronously and no early board event is lost.
 * Errors reach the client as `connect_error` with the message below.
 */
io.use(async (socket, next) => {
  const auth = (socket.handshake.auth ?? {}) as SocketAuth;
  const s = store.get(String(auth.sessionId ?? ''));
  if (!s || s.ended) return next(new Error('This class has ended or does not exist.'));
  const data = socket.data as SocketData;
  data.sessionId = s.info.id;
  data.clientId = String(auth.clientId ?? socket.id).slice(0, 40);
  // The board display needs only its key; everyone else signs in.
  if (auth.boardKey) {
    if (auth.boardKey !== s.boardKey) return next(new Error('This board link is not valid for the class.'));
    Object.assign(data, { role: 'board', uid: `board:${s.info.id}`, name: 'Classroom board' });
    return next();
  }
  const user = await verifyUser(auth.idToken, auth.dev);
  if (!user) return next(new Error('Please sign in to join the class.'));
  Object.assign(data, { role: user.uid === s.teacherUid ? 'teacher' : 'student', uid: user.uid, name: user.name });
  next();
});

io.on('connection', (socket: Socket<ClientToServer, ServerToClient>) => {
  const { sessionId, role, uid, name, clientId } = socket.data as SocketData;
  const s = store.get(sessionId);
  if (!s) return socket.disconnect(true);
  const canWrite = role === 'teacher';

  socket.join(room(s));
  if (role === 'teacher') socket.join(teacherRoom(s));
  socket.join(userRoom(s, uid));

  if (role === 'student') {
    const r = s.roster.get(uid);
    if (r) {
      r.online = true;
      r.sockets++;
    } else {
      s.roster.set(uid, { uid, name, online: true, hand: false, joinedAt: Date.now(), sockets: 1 });
    }
  }

  socket.emit('welcome', { role, me: { uid, name, clientId }, session: s.info, cls: s.cls, canWrite });
  if (role === 'teacher') socket.emit('roster', rosterList(s));
  if (role === 'student') socket.emit('hand', s.roster.get(uid)!.hand);
  pushPresence(s);

  // Catch-up: replay what was missed, or send the whole board.
  socket.on('sync', (lastSeq) => {
    const tail = store.tailSince(s, Number(lastSeq));
    if (tail) socket.emit('tail', tail);
    else socket.emit('snap', s.board);
  });

  socket.on('b', (body) => {
    if (!canWrite || s.ended || !validEvent(body)) return;
    const ev = { ...body, seq: s.board.seq + 1, o: clientId, at: Date.now() } as BoardEvent;
    store.append(s, ev);
    io.to(room(s)).emit('b', ev);
  });

  socket.on('hand', (up) => {
    if (role !== 'student') return;
    const r = s.roster.get(uid);
    if (!r) return;
    r.hand = Boolean(up);
    r.handAt = r.hand ? Date.now() : undefined;
    io.to(userRoom(s, uid)).emit('hand', r.hand);
    io.to(teacherRoom(s)).emit('roster', rosterList(s));
  });

  socket.on('lower', (who) => {
    if (role !== 'teacher') return;
    const r = s.roster.get(String(who));
    if (!r) return;
    r.hand = false;
    r.handAt = undefined;
    io.to(userRoom(s, r.uid)).emit('hand', false);
    io.to(teacherRoom(s)).emit('roster', rosterList(s));
  });

  socket.on('cls', (patch) => {
    if (role !== 'teacher') return;
    if (typeof patch?.showJoin === 'boolean') s.cls.showJoin = patch.showJoin;
    io.to(room(s)).emit('cls', s.cls);
  });

  socket.on('end', () => {
    if (role !== 'teacher') return;
    s.ended = true;
    s.cls.live = false;
    io.to(room(s)).emit('ended');
  });

  socket.on('disconnect', () => {
    if (role !== 'student') return;
    const r = s.roster.get(uid);
    if (!r) return;
    r.sockets = Math.max(0, r.sockets - 1);
    if (r.sockets === 0) r.online = false;
    pushPresence(s);
  });
});

http.listen(config.port, () => {
  console.log(`NET360 Classroom server on :${config.port} — auth: ${authMode}, video: ${mediaEnabled ? 'on' : 'off'}`);
});
