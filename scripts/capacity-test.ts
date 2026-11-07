/**
 * Big classes: the size a teacher picks is kept, 500 students fit, the next one is
 * told the class is full, seats are unique and the front seats are filled first.
 * Also checks the board modes reach every screen.
 *
 *   npm start   (in another terminal)
 *   npm run test:capacity
 */
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { boardView, type BoardEvent, type BoardState, type PersonPublic, type Welcome } from '../packages/protocol/src/index.ts';
import { BoardSession } from '../packages/board-engine/src/session.ts';

const URL_ = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

async function main() {
  const devT = { uid: 'teacher-cap', name: 'Sir Ahmed' };
  const start = async (size: unknown) => {
    const res = await fetch(`${URL_}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(devT)) },
      body: JSON.stringify({ subject: 'Physics', topic: 'Auditorium', size }),
    });
    return ((await res.json()) as { session: { id: string; code: string; size: number } }).session;
  };
  check((await start(7)).size === 40, 'an unknown class size falls back to 40');
  const session = await start(500);
  check(session.size === 500, 'the teacher’s class size (500) is kept');

  const join = (i: number, uid = `cap${i}`) => {
    const board = new BoardSession(uid);
    const sock: Socket = io(URL_, {
      parser: msgpackParser,
      transports: ['websocket'],
      auth: { sessionId: session.id, code: session.code, clientId: `c${i}-${Math.random().toString(36).slice(2, 6)}`, dev: { uid, name: `Student ${i}` } },
      reconnection: false,
    });
    const st = { welcome: null as Welcome | null, people: [] as PersonPublic[], error: '' };
    sock.on('welcome', (w: Welcome) => {
      st.welcome = w;
      board.resync();
    });
    sock.on('people', (p: PersonPublic[]) => (st.people = p));
    sock.on('connect_error', (e) => (st.error = e.message));
    sock.on('snap', (s: BoardState) => board.snapshot(s));
    sock.on('tail', (evs: BoardEvent[]) => board.tail(evs));
    sock.on('b', (e: BoardEvent) => board.remote(e));
    board.setTransport(() => {}, (seq) => sock.emit('sync', seq));
    return { sock, st, board, uid };
  };

  const students: ReturnType<typeof join>[] = [];
  for (let i = 0; i < 500; i++) {
    students.push(join(i));
    if (i % 100 === 99) await sleep(300);
  }
  await sleep(3000);
  check(students.every((s) => s.st.welcome), `500 students are in (${students.filter((s) => s.st.welcome).length})`);
  const extra = join(500);
  await sleep(1500);
  check(!extra.st.welcome && /full/.test(extra.st.error), `student 501 is told the class is full (“${extra.st.error}”)`);

  // Every screen settles on one list of who is in class.
  await sleep(1200);
  const people = students[0].st.people;
  const seats = new Set(people.map((p) => p.seat));
  check(people.length === 500 && seats.size === 500, `500 seats, none shared (${seats.size})`);
  check(Math.max(...seats) === 499, 'seats are 1 … 500, front first');
  check(students.slice(-1)[0].st.people.length === 500, 'the last student sees the whole class');

  // Ten leave; ten new students take the front-most free seats.
  const leaving = students.slice(20, 30);
  const freed = leaving.map((s) => people.find((p) => p.uid === `dev:${s.uid}`)?.seat ?? -1).sort((a, b) => a - b);
  leaving.forEach((s) => s.sock.disconnect());
  await sleep(1200);
  const fresh = Array.from({ length: 10 }, (_, k) => join(600 + k));
  await sleep(2000);
  const after = students[0].st.people;
  const freshSeats = fresh.map((s) => after.find((p) => p.uid === `dev:${s.uid}`)?.seat ?? -1).sort((a, b) => a - b);
  check(fresh.every((s) => s.st.welcome) && JSON.stringify(freshSeats) === JSON.stringify(freed), 'new students fill the seats that were freed');
  // Someone who was here before may always come back, even when the class is full again.
  const back = join(20, leaving[0].uid);
  await sleep(1500);
  check(Boolean(back.st.welcome), 'a student who was in class gets back in when it is full');

  // Board modes reach everyone.
  const teacher = io(URL_, { parser: msgpackParser, transports: ['websocket'], auth: { sessionId: session.id, clientId: 'tcap', dev: devT } });
  await sleep(800);
  teacher.emit('b', { t: 'md', m: 'split' });
  await sleep(500);
  check(boardView(students[499].board.state).mode === 'board', 'without slides, Side by side is ignored');
  teacher.emit('b', { t: 'sl', imgs: [`${session.id}/aaaaaa.jpg`, `${session.id}/bbbbbb.jpg`] });
  await sleep(1200);
  const modes = () => students.filter((s) => s.sock.connected).map((s) => boardView(s.board.state).mode);
  check(modes().every((m) => m === 'slides'), 'new slides come up on every screen');
  teacher.emit('b', { t: 'md', m: 'split' });
  await sleep(1200);
  check(modes().every((m) => m === 'split'), 'side by side on every screen');
  teacher.emit('b', { t: 'md', m: 'board' });
  await sleep(1200);
  check(modes().every((m) => m === 'board'), 'back to the whiteboard on every screen');

  [...students, ...fresh, extra, back].forEach((s) => s.sock.disconnect());
  teacher.disconnect();
  console.log(failed ? `\n${failed} failed` : '\nBig classes work.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
