/**
 * Redeploy test: a class survives the server restarting mid-lesson.
 *
 * Starts the D1 stand-in and the server, runs a class (teacher + students + board),
 * stops the server with SIGTERM (what Railway does on redeploy), starts it again,
 * and checks every screen gets the same board back and keeps syncing new strokes.
 *
 *   npx tsx scripts/restart-test.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { BoardSession } from '../packages/board-engine/src/session.ts';
import { encodeAbs, type BoardState, type Welcome } from '../packages/protocol/src/index.ts';

const PORT = 4100;
const D1_PORT = 8799;
const URL_ = `http://localhost:${PORT}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const env = {
  ...process.env,
  PORT: String(PORT),
  CLOUDFLARE_API_BASE: `http://localhost:${D1_PORT}`,
  CLOUDFLARE_ACCOUNT_ID: 'test',
  CLOUDFLARE_D1_DATABASE_ID: 'test',
  CLOUDFLARE_API_TOKEN: 'test',
  SNAPSHOT_EVERY_SECONDS: '60', // force the shutdown flush to do the saving
  ERASE_AFTER_END_SECONDS: '2',
  R2_BUCKET: 'net360classroom',
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_ENDPOINT: `http://localhost:${D1_PORT}`,
};

function startServer(): Promise<ChildProcess> {
  const p = spawn('node', ['--import', 'tsx', 'apps/server/src/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr!.on('data', (d) => process.stderr.write(`  [server] ${d}`));
  return new Promise((resolve) => {
    p.stdout!.on('data', (d: Buffer) => {
      const line = d.toString();
      process.stdout.write(`  [server] ${line}`);
      if (/server on :/.test(line)) resolve(p);
    });
  });
}

interface Client { name: string; board: BoardSession; sock: Socket; epochs: Set<string> }
function connect(name: string, auth: Record<string, unknown>): Client {
  const clientId = `${name}-${Math.random().toString(36).slice(2, 6)}`;
  const board = new BoardSession(clientId);
  const sock = io(URL_, { parser: msgpackParser, transports: ['websocket'], auth: { ...auth, clientId }, reconnectionDelay: 300 });
  board.setTransport((ev) => sock.emit('b', ev), (seq) => sock.emit('sync', seq));
  const epochs = new Set<string>();
  let epoch: string | null = null;
  // Same logic as the web app's useClassroom.
  sock.on('welcome', (w: Welcome) => {
    if (epoch && epoch !== w.epoch) board.reset();
    epoch = w.epoch;
    epochs.add(w.epoch);
    board.resync();
  });
  sock.on('snap', (s) => board.snapshot(s));
  sock.on('tail', (t) => board.tail(t));
  sock.on('b', (ev) => board.remote(ev));
  return { name, board, sock, epochs };
}

const fp = (s: BoardState) =>
  JSON.stringify(s.order.map((id) => [id, s.strokes[id].hidden, s.strokes[id].pts.length, Math.round(s.strokes[id].pts.reduce((a, b) => a + b, 0))]).concat([[s.pages, s.page]]));

function draw(t: Client, k: number) {
  const id = `r${k}`;
  let last = encodeAbs(100 + k * 40, 200, 0.5);
  t.board.local({ t: 's', id, pg: t.board.state.page, st: { tool: 'pen', c: '#F4F1EA', w: 4 }, p: last });
  for (let b = 0; b < 5; b++) {
    const p: number[] = [];
    for (let j = 0; j < 4; j++) {
      const q = encodeAbs(100 + k * 40 + (b * 4 + j) * 3, 200 + Math.sin(b + j) * 20, 0.5);
      p.push(q[0] - last[0], q[1] - last[1], q[2]);
      last = q;
    }
    t.board.local({ t: 'p', id, p, d: b * 16 });
  }
  t.board.local({ t: 'e', id });
}

async function d1(sql: string) {
  const r = await fetch(`http://localhost:${D1_PORT}/client/v4/accounts/t/d1/database/t/query`, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  return ((await r.json()) as { result: { results: Record<string, unknown>[] }[] }).result[0].results;
}

async function main() {
  const d1p = spawn('node', ['scripts/d1-local.mjs', String(D1_PORT)], { stdio: 'ignore' });
  await sleep(800);
  let server = await startServer();

  const devT = { uid: 'teach-r', name: 'Ms. Restart' };
  const res = await fetch(`${URL_}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(devT)) },
    body: JSON.stringify({ subject: 'Physics', topic: 'Restart test' }),
  });
  const { session, boardKey } = (await res.json()) as { session: { id: string; code: string }; boardKey: string };

  const teacher = connect('teacher', { sessionId: session.id, dev: devT });
  const display = connect('board', { sessionId: session.id, boardKey });
  const students = Array.from({ length: 10 }, (_, i) => connect(`s${i}`, { sessionId: session.id, code: session.code, dev: { uid: `rs${i}`, name: `Student ${i}` } }));
  const everyone = [teacher, display, ...students];
  await sleep(1200);

  for (let k = 0; k < 8; k++) draw(teacher, k);
  teacher.board.local({ t: 'h', ids: ['r3'] }); // an undo
  students[0].sock.emit('hand', true);
  students[1].sock.emit('chat', { text: 'Message before the restart' });
  await sleep(600);
  const before = fp(teacher.board.state);
  const seqBefore = teacher.board.state.seq;

  console.log('\nStopping the server mid-lesson (SIGTERM, like a Railway redeploy)…');
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  await sleep(500);
  server = await startServer();
  await sleep(3000); // clients reconnect on their own

  const restored = everyone.filter((c) => fp(c.board.state) === before).length;
  const history: { text: string }[][] = [];
  const t2 = connect('teacher2', { sessionId: session.id, dev: devT });
  t2.sock.on('chatHistory', (h: { text: string }[]) => history.push(h));
  await sleep(1200);
  const chatBack = Boolean(history.at(-1)?.some((m) => m.text === 'Message before the restart'));
  console.log(`Messages after restart: ${chatBack ? 'restored' : 'MISSING'}`);
  t2.sock.disconnect();
  const newEpoch = everyone.every((c) => c.epochs.size === 2);
  console.log(`\nAfter restart: ${restored}/${everyone.length} screens have the full board back (seq ${seqBefore}), new epoch seen by all: ${newEpoch}`);

  for (let k = 8; k < 12; k++) draw(teacher, k);
  await sleep(1000);
  const after = fp(teacher.board.state);
  const synced = everyone.filter((c) => fp(c.board.state) === after).length;
  console.log(`New strokes after restart reach ${synced}/${everyone.length} screens`);

  const sessions = await d1(`SELECT status FROM class_sessions WHERE id = '${session.id}'`);
  const people = await d1(`SELECT COUNT(*) AS n FROM session_participants WHERE session_id = '${session.id}'`);
  const hands = await d1(`SELECT COUNT(*) AS n FROM hand_raises WHERE session_id = '${session.id}'`);
  const snap = await d1(`SELECT strokes, location, bytes FROM board_snapshots WHERE session_id = '${session.id}'`);
  console.log(`D1 while live: meeting ${sessions[0]?.status}, attendance rows ${people[0]?.n}, hand rows ${hands[0]?.n} (none are kept)`);
  console.log(`Board kept for the live meeting in ${String(snap[0]?.location).toUpperCase()}: ${snap[0]?.strokes} strokes, ${snap[0]?.bytes} bytes`);

  // Ending the meeting leaves nothing behind.
  teacher.sock.emit('end');
  await sleep(3500);
  const left: Record<string, number> = {};
  for (const t of ['class_sessions', 'board_snapshots', 'chat_messages', 'session_settings', 'session_kind', 'session_participants', 'hand_raises']) {
    const col = t === 'class_sessions' ? 'id' : 'session_id';
    left[t] = Number((await d1(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = '${session.id}'`))[0]?.n);
  }
  const r2Left = await fetch(`http://localhost:${D1_PORT}/net360classroom?list-type=2&prefix=boards/`, { headers: { Authorization: 'AWS4-HMAC-SHA256 x' } }).then((r) => r.text());
  const erased = Object.values(left).every((n) => n === 0) && !r2Left.includes(session.id);
  console.log(`After the meeting ended: ${erased ? 'nothing kept' : 'STILL STORED ' + JSON.stringify(left) + ' ' + r2Left}`);

  const ok =
    restored === everyone.length && newEpoch && synced === everyone.length && chatBack &&
    people[0]?.n === 0 && hands[0]?.n === 0 && snap[0]?.location === 'r2' && erased;
  console.log(ok ? '\nPASS' : '\nFAIL');
  everyone.forEach((c) => c.sock.disconnect());
  await sleep(300);
  server.kill('SIGTERM');
  await new Promise((r) => server.once('exit', r));
  d1p.kill();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
