# NET360 Interactive Classroom

A physical classroom enhanced by a synchronized digital board. The teacher writes on a pen tablet; the handwriting appears instantly on the classroom TV/projector and on every student's phone, tablet or laptop — sent as pen strokes, never as video.

## What works now (MVP Phases 0–2, plus raise hand)

| | |
| --- | --- |
| **Start a class** | Teacher signs in, picks subject and topic, gets a 6-character code and QR |
| **Join** | Scan the board's QR with the phone camera, or type the code → one tap → in |
| **Live whiteboard** | Pressure-sensitive pen, highlighter, line, arrow, rectangle, circle, 5 colours, 3 widths, eraser, undo/redo, clear page, multiple pages |
| **Pen tablets** | Wacom, XP-Pen, Huion and similar work through the browser — no driver code. Full sample rate via coalesced pointer events; palm rejection |
| **Classroom board display** | Full-screen view for the TV/projector; big join card before class, small corner card after; wake lock |
| **Student view** | The board and almost nothing else; browse earlier pages with a "Back to live" chip; save notes as PDF |
| **Raise hand** | One floating button; the teacher sees a queue in the order hands went up |
| **Reconnects** | Drop off the network and come back: missed strokes are replayed, or the whole board is sent if the gap is long |
| **Notes** | Teacher and students can save every written page as a PDF |

**Tested:** one teacher writing to 40 students + the board display. Every screen — including 5 students cut off mid-lesson and a late joiner — ended identical to the teacher's board. Server-side delivery: median ~1 ms, p99 ~6 ms (real classroom Wi-Fi adds its own round trip). Run it yourself with `npm run loadtest`.

## Quick start

```bash
npm install
npm run build        # builds the web app
npm start            # http://localhost:4000 — serves the app and the realtime server
```

For development with hot reload: `npm run dev` (web on :5173, server on :4000).

Without Firebase settings the app runs in **dev mode**: you sign in with just a name. Open the teacher in one tab and students in other tabs (each tab is a separate person).

### Try it in a real room

1. Run the server on a laptop; note its local IP (e.g. `192.168.1.20`).
2. Teacher opens `http://192.168.1.20:4000` → **Start a class**.
3. In the teacher's right rail, tap **Board** — that opens the display view; drag it to the TV and press **Full screen**.
4. Students scan the QR on the TV with their phone camera (phones must be on the same Wi-Fi).

> Phone browsers only allow the in-page QR scanner on HTTPS. Over plain HTTP on a local network, students scan with the phone's own camera app (the QR is a normal link) or type the code. Deployed on HTTPS, both work.

### Teacher shortcuts

`P` pen · `H` highlighter · `E` eraser · `L` line · `A` arrow · `R` rectangle · `C` circle · `1–5` colours · `Ctrl+Z` / `Ctrl+Y` undo/redo · `N` new page · `←` `→` / `PageUp` `PageDown` change page. Map your tablet's express keys to these in the tablet driver.

## Firebase sign-in

1. Firebase console → your project → **Authentication** → enable **Google**.
2. Add your domain under **Authorized domains**.
3. Copy `.env.example` to `.env` and fill in `FIREBASE_PROJECT_ID` and the four `VITE_FIREBASE_*` values from **Project settings → Your apps**.
4. Optional: `TEACHER_EMAILS=a@x.com,b@y.com` limits who can start classes.
5. `npm run build && npm start`.

## Video (Phase 4) — LiveKit Cloud or self-hosted

Both use the same code; only three settings change (see `.env.example`). The server already issues LiveKit tokens at `POST /api/sessions/:id/media-token` (teacher can publish; students subscribe only). Start with **LiveKit Cloud** for the pilot (no servers to run); move to **self-hosted** on your own VPS when classroom minutes make it cheaper. For local testing: `docker compose up livekit`.

## Project layout

```text
apps/
  web/            React + Vite: /, /join, /class/:id (student), /teach/:id (teacher), /board/:id (display)
  server/         Express + Socket.IO realtime server, Firebase token check, LiveKit tokens,
                  Cloudflare D1 persistence (db/schema.sql), Dockerfile for Railway
packages/
  protocol/       Event types, compact stroke encoding, the shared board reducer
  board-engine/   Board sync, two-layer canvas renderer, pen input, notes export
scripts/
  loadtest.ts     40-student sync and latency test
  restart-test.ts a class survives the server restarting mid-lesson
  d1-local.mjs    local stand-in for the Cloudflare D1 API (testing)
vercel.json       web app on Vercel
railway.json      realtime server on Railway
```

### How sync works

Every board change is a small event (`stroke start`, `points`, `end`, `hide`, `show`, `page`). Points travel as integer deltas with pressure as one byte, MessagePack-encoded — a few bytes per point. The server numbers each event and broadcasts it; every client folds the same numbered events into the same board. The teacher's own screen draws immediately and never waits for the network. A client that reconnects says "I have up to #N" and receives just the missing events, or a snapshot if it was gone too long.

## Deploy

**Web app on Vercel, realtime server on Railway, database on Cloudflare D1** — step-by-step in [DEPLOY.md](DEPLOY.md).

Live classes run in the Railway process; every few seconds (and on shutdown) changed boards are saved to D1 with sessions, attendance and raised hands. After a redeploy the server restores live classes and every screen reloads the board automatically.

Alternatively, one Node process can serve everything: `npm run build && npm start` behind HTTPS.

## Next phases

3. Board, student view and raise hand polish from the first pilot lecture
4. Teacher and student video (LiveKit)
5. Student Solve mode — invited student writes on the board, teacher annotates
6. Live questions — MCQ with countdown, private answers, reveal
7. Groups, recording, participation analytics from the D1 data; notes archive per student
