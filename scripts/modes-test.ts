/**
 * Board / slides / split: the rules every screen applies identically.
 *   npx tsx scripts/modes-test.ts
 */
import { applyEvent, boardView, emptyBoard, type BoardEventBody, type BoardState } from '../packages/protocol/src/index.ts';

let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails++;
};
const run = (s: BoardState, ...evs: BoardEventBody[]) => {
  for (const e of evs) applyEvent(s, e);
  return boardView(s);
};
const stroke = (pg: number, id = `x${Math.random()}`): BoardEventBody => ({ t: 's', id, pg, st: { tool: 'pen', c: '#fff', w: 4 }, p: [0, 0, 128] });

// Fresh board: whiteboard only, slides not possible yet.
let s = emptyBoard();
let v = boardView(s);
check(v.mode === 'board' && v.wb === 0 && v.slide === null, 'a new class starts on the whiteboard');
v = run(s, { t: 'md', m: 'slides' });
check(v.mode === 'board', 'no slides yet: Slides does nothing');

// Write, then add three slides: they come straight up.
v = run(s, stroke(0), { t: 'sl', imgs: ['abcdef/aaaaaa.jpg', 'abcdef/bbbbbb.jpg', 'abcdef/cccccc.jpg'] });
check(v.mode === 'slides' && v.slide === 1 && s.page === 1 && v.wb === 0, 'added slides appear at once, whiteboard kept');
v = run(s, { t: 'pg', pg: 2 });
check(v.mode === 'slides' && v.slide === 2, 'next slide');
v = run(s, { t: 'md', m: 'board' });
check(v.mode === 'board' && s.page === 0 && v.slide === 2, 'whiteboard hides the slides and remembers the slide');
v = run(s, { t: 'md', m: 'slides' });
check(v.mode === 'slides' && s.page === 2, 'back to the same slide');
v = run(s, { t: 'md', m: 'split' });
check(v.mode === 'split' && v.slide === 2 && v.wb === 0, 'side by side: slide and whiteboard');
v = run(s, { t: 'pg', pg: 3 });
check(v.mode === 'split' && v.slide === 3 && v.wb === 0, 'turning a slide in split keeps the whiteboard');
v = run(s, { t: 'pn' });
check(v.mode === 'split' && v.wb === 4 && v.slide === 3 && v.boards.join() === '0,4', 'new whiteboard page in split');
v = run(s, { t: 'pg', pg: 0 });
check(v.mode === 'split' && v.wb === 0 && v.slide === 3, 'earlier whiteboard page in split');
v = run(s, { t: 'md', m: 'slides' }, { t: 'pn' });
check(v.mode === 'board' && v.wb === 5, 'a new page from the slides opens the whiteboard');
v = run(s, { t: 'pg', pg: 1 });
check(v.mode === 'slides' && v.slide === 1, 'going to a slide page opens the slides');

// Slides on a blank board use page 1; the whiteboard is made when asked for.
s = emptyBoard();
v = run(s, { t: 'sl', imgs: ['abcdef/aaaaaa.jpg'] });
check(v.mode === 'slides' && v.slide === 0 && v.wb === null, 'deck on a blank board starts at page 1');
v = run(s, { t: 'md', m: 'board' });
check(v.mode === 'board' && v.wb === 1 && s.pages === 2, 'whiteboard page is created when needed');
v = run(s, { t: 'md', m: 'split' });
check(v.mode === 'split' && v.slide === 0 && v.wb === 1, 'split after that');

// Boards saved before modes existed still read right.
const old: BoardState = { seq: 3, pages: 3, page: 2, order: [], strokes: {}, bg: { 1: 'a/b.jpg', 2: 'a/c.jpg' } };
v = boardView(old);
check(v.mode === 'slides' && v.slide === 2 && v.wb === 0, 'older saved boards open in the right mode');

console.log(fails ? `\n${fails} failed` : '\nModes work.');
process.exit(fails ? 1 : 0);
