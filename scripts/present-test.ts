/**
 * Presenting rules: only the teacher (or the student they allow) may add slides or
 * turn pages; requests, "not now" and "stop" reach the right people.
 *
 *   npm start   (in another terminal)
 *   npm run test:present
 */
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import type { BoardEvent, PresentState } from '../packages/protocol/src/index.ts';

const URL_ = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};
const jpeg = () => {
  const b = new Uint8Array(4000);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b.buffer;
};

async function main() {
  const devT = { uid: 'teacher-present', name: 'Sir Ahmed' };
  const res = await fetch(`${URL_}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(devT)) },
    body: JSON.stringify({ subject: 'Physics', topic: 'Slides' }),
  });
  const { session } = (await res.json()) as { session: { id: string; code: string } };
  const join = (auth: Record<string, unknown>) => {
    const sock: Socket = io(URL_, { parser: msgpackParser, transports: ['websocket'], auth: { sessionId: session.id, clientId: Math.random().toString(36).slice(2), ...auth } });
    const state = { present: null as PresentState | null, evs: [] as BoardEvent[], declined: 0 };
    sock.on('present', (p: PresentState) => (state.present = p));
    sock.on('b', (e: BoardEvent) => state.evs.push(e));
    sock.on('presentDeclined', () => state.declined++);
    return { sock, state };
  };
  const upload = (sock: Socket) => new Promise<{ img?: string; error?: string }>((r) => sock.emit('slideUpload', jpeg(), r));

  const teacher = join({ dev: devT });
  const ali = join({ code: session.code, dev: { uid: 'ali', name: 'Ali Khan' } });
  const sara = join({ code: session.code, dev: { uid: 'sara', name: 'Sara Malik' } });
  await sleep(700);

  // Teacher adds slides.
  const up = await upload(teacher.sock);
  check(Boolean(up.img?.startsWith(`${session.id}/`)), 'the teacher can upload a slide');
  teacher.sock.emit('b', { t: 'sl', imgs: [up.img!, up.img!] });
  await sleep(400);
  check(ali.state.evs.some((e) => e.t === 'sl'), 'students receive the slides');
  const img = await fetch(`${URL_}/api/slides/${up.img}`);
  check(img.status === 200 && img.headers.get('content-type') === 'image/jpeg', 'the slide image can be downloaded');

  // A student can't present without permission.
  const no = await upload(ali.sock);
  check(Boolean(no.error), 'a student cannot upload slides without permission');
  const before = sara.state.evs.length;
  ali.sock.emit('b', { t: 'pg', pg: 1 });
  ali.sock.emit('b', { t: 's', id: 'x1', pg: 0, st: { tool: 'pen', c: '#fff', w: 4 }, p: [0, 0, 100] });
  await sleep(400);
  check(sara.state.evs.length === before, 'a student cannot turn pages or write without permission');

  // Asking, "not now", then allowing.
  ali.sock.emit('presentAsk', true);
  await sleep(300);
  check(teacher.state.present?.requests.some((r) => r.uid === 'dev:ali') ?? false, 'the teacher sees the request');
  check((ali.state.present?.requests.length ?? 0) === 0, 'students do not see others’ requests');
  teacher.sock.emit('presentDecline', 'dev:ali');
  await sleep(300);
  check(ali.state.declined === 1 && !(teacher.state.present?.requests.length), '“Not now” reaches the student and clears the request');
  ali.sock.emit('presentAsk', true);
  await sleep(200);
  teacher.sock.emit('presentSet', 'dev:ali');
  await sleep(400);
  check(sara.state.present?.presenter === 'dev:ali' && sara.state.present.presenterName === 'Ali Khan', 'everyone sees who is presenting');
  const ok = await upload(ali.sock);
  check(Boolean(ok.img), 'the presenting student can upload slides');
  ali.sock.emit('b', { t: 'pg', pg: 1 });
  await sleep(300);
  check(sara.state.evs.some((e) => e.t === 'pg' && e.pg === 1), 'the presenting student can turn the class’s page');
  const n = sara.state.evs.length;
  ali.sock.emit('b', { t: 's', id: 'x2', pg: 1, st: { tool: 'pen', c: '#fff', w: 4 }, p: [0, 0, 100] });
  await sleep(300);
  check(sara.state.evs.length === n, 'the presenting student still cannot write on the board');
  const forged = `${session.id.replace(/./, 'Z')}/abcdefghij.jpg`;
  ali.sock.emit('b', { t: 'sl', imgs: [forged] });
  await sleep(300);
  check(sara.state.evs.length === n, 'slides from another class are refused');

  // Teacher stops the presentation.
  teacher.sock.emit('presentSet', null);
  await sleep(300);
  check(ali.state.present?.presenter === null, 'the teacher can stop a student presenting');
  check(Boolean((await upload(ali.sock)).error), 'after stopping, the student can no longer upload');

  for (const c of [teacher, ali, sara]) c.sock.disconnect();
  console.log(failed ? `\n${failed} check(s) failed` : '\nPresenting works.');
  process.exit(failed ? 1 : 0);
}
void main();
