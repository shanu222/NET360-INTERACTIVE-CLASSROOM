/**
 * Seat a big class for looking at it: starts a class for N students and keeps
 * N students connected for a few minutes.  npx tsx scripts/fill-big.ts 500
 */
import { io } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
const URL_ = process.env.URL ?? 'http://localhost:4000';
const N = Number(process.argv[2] ?? 500);
const T = { uid: 'tchBig', name: 'Shahnawaz' };
const first = ['Hamza', 'Zainab', 'Bilal', 'Sana', 'Usman', 'Ayesha', 'Fatima', 'Ali', 'Hira', 'Omar', 'Maryam', 'Daniyal', 'Noor', 'Ahmed', 'Iqra', 'Saad'];
const last = ['Ali', 'Noor', 'Khan', 'Iqbal', 'Tariq', 'Malik', 'Zahra', 'Raza', 'Shah', 'Farooq', 'Aziz', 'Ahmed'];
async function main() {
  const res = await fetch(`${URL_}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Dev-User': encodeURIComponent(JSON.stringify(T)) },
    body: JSON.stringify({ subject: 'Physics', topic: 'Heat and Thermodynamics', size: N >= 300 ? 500 : N >= 150 ? 300 : N >= 60 ? 150 : N > 40 ? 60 : 40 }),
  });
  const { session, boardKey } = await res.json();
  console.log(JSON.stringify({ id: session.id, code: session.code, key: boardKey, size: session.size }));
  let ok = 0;
  let full = 0;
  for (let i = 0; i < N; i++) {
    const s = io(URL_, {
      parser: msgpackParser,
      transports: ['websocket'],
      auth: { sessionId: session.id, code: session.code, clientId: `b${i}`, dev: { uid: `big${i}`, name: `${first[i % 16]} ${last[(i * 7) % 12]}` } },
    });
    s.on('welcome', () => ok++);
    s.on('connect_error', (e) => /full/.test(e.message) && full++);
    if (i % 50 === 49) await new Promise((r) => setTimeout(r, 200));
    if (i === 30 || i === 260 || i === 470) s.on('welcome', () => s.emit('hand', true));
  }
  await new Promise((r) => setTimeout(r, 4000));
  console.error(`seated ${ok}, refused as full ${full}`);
  setTimeout(() => process.exit(0), Number(process.env.HOLD ?? 300000));
}
void main();
