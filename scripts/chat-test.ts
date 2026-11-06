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

for (const c of [teacher, sara, ali2, t2]) c.sock.disconnect();
console.log(failed ? `\n${failed} check(s) failed` : '\nChat works.');
process.exit(failed ? 1 : 0);
}
void main();
