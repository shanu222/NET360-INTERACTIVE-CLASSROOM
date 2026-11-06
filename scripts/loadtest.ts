/**
 * Classroom load test: one teacher writes pen strokes while 40 students and the
 * board display watch. Measures pen-to-screen delivery time and checks that
 * every screen — including students who drop out mid-lesson and a late joiner —
 * ends with exactly the same board.
 *
 *   npm start            (in another terminal)
 *   npm run loadtest     [-- --url http://localhost:4000 --students 40]
 */
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { BoardSession } from '../packages/board-engine/src/session.ts';
import { encodeAbs, type BoardState } from '../packages/protocol/src/index.ts';

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const URL_ = arg('url', 'http://localhost:4000');
const STUDENTS = Number(arg('students', '40'));
const STROKES = Number(arg('strokes', '24'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Client { name: string; sock: Socket; board: BoardSession; synced: Promise<void> }
const sent = new Map<string, number>(); // "strokeId:d" → send time
const delays: number[] = [];

function connect(name: string, auth: Record<string, unknown>, measure = false): Client {
  const clientId = `${name}-${Math.random().toString(36).slice(2, 7)}`;
  const board = new BoardSession(clientId);
  const sock = io(URL_, { parser: msgpackParser, transports: ['websocket'], auth: { ...auth, clientId }, reconnectionDelay: 200 });
  board.setTransport((ev) => sock.emit('b', ev), (seq) => sock.emit('sync', seq));
  let resolve!: () => void;
  const synced = new Promise<void>((r) => (resolve = r));
  sock.on('connect', () => board.resync());
  sock.on('snap', (s) => { board.snapshot(s); resolve(); });
  sock.on('tail', (t) => { board.tail(t); resolve(); });
  sock.on('b', (ev) => {
    if (measure && ev.t === 'p') {
      const t0 = sent.get(`${ev.id}:${ev.d}`);
      if (t0 !== undefined) delays.push(performance.now() - t0);
    }
    board.remote(ev);
  });
  sock.on('connect_error', (e) => console.error(name, 'connect_error', e.message));
  return { name, sock, board, synced };
}

/** Compare boards by what is visible, point for point. */
function fingerprint(s: BoardState) {
  return JSON.stringify({
    pages: s.pages,
    page: s.page,
    strokes: s.order.map((id) => {
      const k = s.strokes[id];
      return [id, k.pg, k.hidden, k.done, k.pts.length, Math.round(k.pts.reduce((a, b) => a + b, 0))];
    }),
  });
}

async function main() {
  const devT = { uid: 'teacher-1', name: 'Ms. Ayesha' };
  const res = await fetch(`${URL_}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(devT)) },
    body: JSON.stringify({ subject: 'Physics', topic: 'Load test' }),
  });
  const { session, boardKey } = (await res.json()) as { session: { id: string; code: string }; boardKey: string };
  console.log(`Class ${session.code} created`);

  const teacher = connect('teacher', { sessionId: session.id, dev: devT });
  const display = connect('board', { sessionId: session.id, boardKey });
  const students = Array.from({ length: STUDENTS }, (_, i) =>
    connect(`s${i}`, { sessionId: session.id, dev: { uid: `stu-${i}`, name: `Student ${i}` } }, true),
  );
  const t0 = performance.now();
  await Promise.all([teacher, display, ...students].map((c) => c.synced));
  console.log(`${STUDENTS} students + board joined and synced in ${Math.round(performance.now() - t0)} ms`);

  // Teacher writes: freehand strokes sampled at ~200 Hz, sent every 16 ms.
  const dropped = students.slice(0, 5);
  let pointsSent = 0;
  for (let k = 0; k < STROKES; k++) {
    if (k === Math.floor(STROKES / 3)) {
      console.log('Dropping 5 students off the network mid-lesson…');
      dropped.forEach((c) => c.sock.io.engine.close());
    }
    if (k === Math.floor(STROKES / 2)) teacher.board.local({ t: 'pn' });
    const id = `k${k}`;
    const pg = teacher.board.state.page;
    const x0 = 100 + (k % 6) * 230;
    const y0 = 160 + Math.floor(k / 6) * 160 % 640;
    teacher.board.local({ t: 's', id, pg, st: { tool: 'pen', c: '#F4F1EA', w: 4.4 }, p: encodeAbs(x0, y0, 0.4) });
    let last = encodeAbs(x0, y0, 0.4);
    const start = performance.now();
    for (let batch = 0; batch < 12; batch++) {
      const p: number[] = [];
      for (let j = 0; j < 3; j++) {
        const step = batch * 3 + j;
        const q = encodeAbs(x0 + step * 5, y0 + Math.sin(step / 3) * 30, 0.4 + 0.3 * Math.sin(step / 5));
        p.push(q[0] - last[0], q[1] - last[1], q[2]);
        last = q;
        pointsSent++;
      }
      const d = Math.round(performance.now() - start) + batch; // unique per batch
      sent.set(`${id}:${d}`, performance.now());
      teacher.board.local({ t: 'p', id, p, d });
      await sleep(16);
    }
    teacher.board.local({ t: 'e', id });
    if (k % 7 === 6) teacher.board.local({ t: 'h', ids: [id] }); // an undo now and then
  }
  console.log(`Teacher wrote ${STROKES} strokes, ${pointsSent} points`);

  // The dropped students come back; a late student joins after class is well underway.
  dropped.forEach((c) => c.sock.io.engine?.close());
  const late = connect('late', { sessionId: session.id, dev: { uid: 'late-1', name: 'Late Student' } });
  await late.synced;
  await sleep(2500);

  const want = fingerprint(teacher.board.state);
  const everyone = [display, ...students, late];
  const mismatched = everyone.filter((c) => fingerprint(c.board.state) !== want);
  delays.sort((a, b) => a - b);
  const pct = (p: number) => delays[Math.min(delays.length - 1, Math.floor((p / 100) * delays.length))].toFixed(1);
  console.log(`\nDelivery, teacher → each student (${delays.length} point batches):`);
  console.log(`  median ${pct(50)} ms · p95 ${pct(95)} ms · p99 ${pct(99)} ms · max ${delays[delays.length - 1].toFixed(1)} ms`);
  console.log(`Screens identical to the teacher: ${everyone.length - mismatched.length}/${everyone.length}` +
    (mismatched.length ? `  (mismatch: ${mismatched.map((c) => c.name).join(', ')})` : ''));
  console.log(`Board seq ${teacher.board.state.seq}, pages ${teacher.board.state.pages}`);

  [teacher, ...everyone].forEach((c) => c.sock.disconnect());
  process.exit(mismatched.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
