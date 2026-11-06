/**
 * Private chat check: each student's messages reach only the teacher, the
 * teacher's reply reaches only that student, and history returns on reconnect.
 *
 *   npm start   (in another terminal)
 *   npm run test:chat
 */
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import type { ChatMessage } from '../packages/protocol/src/index.ts';

const URL_ = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:4000';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

function join(auth: Record<string, unknown>) {
  const got: ChatMessage[] = [];
  let history: ChatMessage[] | null = null;
  const sock: Socket = io(URL_, { parser: msgpackParser, transports: ['websocket'], auth: { ...auth, clientId: Math.random().toString(36).slice(2) } });
  sock.on('chat', (m: ChatMessage) => got.push(m));
  sock.on('chatHistory', (h: ChatMessage[]) => (history = h));
  return { sock, got, history: () => history };
}

async function main() {
const devT = { uid: 'teacher-chat', name: 'Sir Ahmed' };
const res = await fetch(`${URL_}/api/sessions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(devT)) },
  body: JSON.stringify({ subject: 'Physics', topic: 'Chat' }),
});
const { session } = (await res.json()) as { session: { id: string; code: string } };
const base = { sessionId: session.id, code: session.code };

const teacher = join({ sessionId: session.id, dev: devT });
const ali = join({ ...base, dev: { uid: 'ali', name: 'Ali Khan' } });
const sara = join({ ...base, dev: { uid: 'sara', name: 'Sara Malik' } });
await sleep(600);

ali.sock.emit('chat', { text: 'Sir, can you repeat the last step?' });
await sleep(400);
sara.sock.emit('chat', { text: 'Is this in the exam?' });
await sleep(400);
teacher.sock.emit('chat', { to: 'dev:ali', text: 'Yes — watch the board.' });
await sleep(400);
teacher.sock.emit('chat', { to: 'nobody', text: 'lost' });
ali.sock.emit('chat', { text: '   ' });
await sleep(500);

check(teacher.got.length === 3, `teacher received every message (${teacher.got.length}/3)`);
check(ali.got.length === 2 && ali.got.every((m) => m.from === 'dev:ali' || m.to === 'dev:ali'), 'Ali sees only his own conversation');
check(sara.got.length === 1 && sara.got[0].from === 'dev:sara', "Sara doesn't see Ali's messages");
check(ali.got.some((m) => m.text === 'Yes — watch the board.' && m.fromName === 'Sir Ahmed'), "teacher's reply reached Ali");
check(!teacher.got.some((m) => m.text === 'lost'), 'messages to someone not in class are dropped');

ali.sock.disconnect();
const ali2 = join({ ...base, dev: { uid: 'ali', name: 'Ali Khan' } });
await sleep(600);
check(ali2.history()?.length === 2, `Ali gets his conversation back after rejoining (${ali2.history()?.length ?? 0})`);
const t2 = join({ sessionId: session.id, dev: devT });
await sleep(600);
check(t2.history()?.length === 3, 'teacher gets every conversation back after reloading');

// Students joining with just their name and the teacher's code (no sign-in).
const tryJoin = (auth: Record<string, unknown>) =>
  new Promise<string>((res) => {
    const c = io(URL_, { parser: msgpackParser, transports: ['websocket'], reconnection: false, auth: { sessionId: session.id, clientId: Math.random().toString(36).slice(2), ...auth } });
    c.on('connect', () => { c.disconnect(); res('joined'); });
    c.on('connect_error', (e) => res(e.message));
  });
const key = 'k'.repeat(10) + Math.random().toString(36).slice(2, 12);
check((await tryJoin({ code: 'WRONG1', guest: { key, name: 'Hira Shah' } })) === 'Wrong class code.', 'a wrong code is refused');
check((await tryJoin({ guest: { key, name: 'Hira Shah' } })) === 'Wrong class code.', 'no code is refused');
check((await tryJoin({ code: session.code, guest: { key, name: ' ' } })) === 'Please enter your name.', 'a missing name is refused');
const rosters: { name: string; online: boolean }[][] = [];
t2.sock.on('roster', (r: { name: string; online: boolean }[]) => rosters.push(r));
const people: { name: string }[][] = [];
sara.sock.on('people', (p: { name: string }[]) => people.push(p));
const hira = join({ sessionId: session.id, code: session.code.toLowerCase(), guest: { key, name: 'Hira Shah' } });
await sleep(700);
check(Boolean(rosters.at(-1)?.some((r) => r.name === 'Hira Shah' && r.online)), 'the teacher sees Hira join with name + code');
check(Boolean(people.at(-1)?.some((p) => p.name === 'Hira Shah')), 'classmates see Hira in the room');
hira.sock.emit('chat', { text: 'Salam sir' });
await sleep(400);
check(t2.got.some((m) => m.text === 'Salam sir' && m.fromName === 'Hira Shah'), 'a name + code student can message the teacher');

// Live: instant-send confirmation, typing and read receipts, end to end.
const seenAtTeacher: { by: string; peer: string; at: number }[] = [];
t2.sock.on('chatSeen', (r: { by: string; peer: string; at: number }[]) => seenAtTeacher.push(...r));
const typingAtHira: string[] = [];
hira.sock.on('typing', (f: string) => typingAtHira.push(f));
const t0 = performance.now();
let echoMs = -1;
hira.sock.once('chat', (m: ChatMessage) => { if (m.cid === 'c-test-1') echoMs = performance.now() - t0; });
const hiraUid = hira.got.at(-1)?.from ?? '';
t2.sock.emit('typing', hiraUid);
t2.sock.emit('chat', { to: hiraUid, text: 'Walaikum salam', cid: 'c-test-1' });
await sleep(400);
const reply = hira.got.find((m) => m.text === 'Walaikum salam');
check(Boolean(reply), 'the teacher\'s reply reached Hira live');
check(typingAtHira.length > 0, 'Hira saw "typing…" while the teacher wrote');
hira.sock.emit('chatSeen', { at: reply?.at ?? 0 });
await sleep(400);
check(seenAtTeacher.some((r) => r.by === hiraUid && r.at === reply?.at), 'the teacher sees ✓✓ Seen once Hira reads it');
const own = t2.got.find((m) => m.text === 'Walaikum salam');
check(own?.cid === 'c-test-1', 'the sender gets its own message confirmed (✓ Sent)');
console.log(`  delivery to the student: ${echoMs < 0 ? 'n/a' : echoMs.toFixed(1) + ' ms'}`);
// A quick burst is delivered in full (no messages silently dropped).
for (let i = 0; i < 5; i++) hira.sock.emit('chat', { text: `burst ${i}` });
await sleep(600);
check(t2.got.filter((m) => m.text.startsWith('burst ')).length === 5, 'a burst of 5 quick messages all arrive');

for (const c of [teacher, sara, ali2, t2, hira]) c.sock.disconnect();
console.log(failed ? `\n${failed} check(s) failed` : '\nChat works.');
process.exit(failed ? 1 : 0);
}
void main();
