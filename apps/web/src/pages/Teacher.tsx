import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { INK, PenInput, type BoardRenderer, type PenSettings } from '@net360/board-engine';
import { useAuth } from '../lib/auth.tsx';
import { useClassroom } from '../lib/classroom.ts';
import { usePageInfo } from '../lib/hooks.ts';
import { api, boardUrl, joinUrl, padUrl } from '../lib/api.ts';
import { saveNotesPdf } from '../lib/notes.ts';
import { Environment } from '../components/Environment.tsx';
import { Board } from '../components/Board.tsx';
import { PenDock } from '../components/PenDock.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Code, QR } from '../components/QR.tsx';
import { Icon } from '../components/Icons.tsx';
import { StatusPill, friendly } from './Student.tsx';
import { Classroom3D, can3d } from '../lib/webgl.ts';
import { Lobby } from '../components/Lobby.tsx';
import { ChatPop, ChatThread, useIncoming, useUnread } from '../components/Chat.tsx';
import type { ChatMessage } from '@net360/protocol';

const KEY_TOOLS: Record<string, PenSettings['tool']> = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'line', a: 'arrow', r: 'rect', c: 'circle' };
const KEY_COLORS = [INK.chalk, INK.amber, INK.sky, INK.mint, INK.coral];

/**
 * The teacher's console: the board exactly as students see it, a pen dock
 * that fades while writing, and a slim rail for the class (code, hands, board).
 */
export default function Teacher() {
  const { sessionId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { ready, user, headers } = useAuth();
  const [boardKey, setBoardKey] = useState<string | undefined>((loc.state as { boardKey?: string } | null)?.boardKey);
  const [padKey, setPadKey] = useState<string | undefined>((loc.state as { padKey?: string } | null)?.padKey);
  // Pen tablet detection: browsers report a tablet stylus as pointerType "pen".
  const [tablet, setTablet] = useState({ seen: false, pressure: false });
  const room = useClassroom(sessionId, { enabled: Boolean(user), as: 'teacher' });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const [pen, setPen] = useState<PenSettings>({ tool: 'pen', color: INK.chalk, width: 4.4 });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [input, setInput] = useState<PenInput | null>(null);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const [writing, setWriting] = useState(false);
  const [panel, setPanel] = useState<'join' | 'class' | 'pen' | 'chat' | null>(() => {
    // First class on this computer: show how to connect the writing tablet.
    try {
      if (localStorage.getItem('n360.penIntro')) return null;
      localStorage.setItem('n360.penIntro', '1');
      return 'pen';
    } catch {
      return null;
    }
  });
  // The student whose conversation is open in the Chat panel.
  const [thread, setThread] = useState<string | null>(null);
  // 'room': the 3D classroom, writing straight onto its board · 'board': the large flat board
  const [mode, setMode] = useState<'room' | 'board'>(() => (can3d() ? 'room' : 'board'));
  // Walking around the 3D classroom (writing pauses while walking).
  const [walking, setWalking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Board key survives a page reload through the owner endpoint.
  useEffect(() => {
    if ((boardKey && padKey) || !user || !sessionId) return;
    headers()
      .then((h) => api.owner(h, sessionId))
      .then((r) => {
        setBoardKey(r.boardKey);
        setPadKey(r.padKey);
      })
      .catch(() => {});
  }, [boardKey, padKey, user, sessionId, headers]);

  useEffect(() => {
    const seen = (e: PointerEvent) => {
      if (e.pointerType !== 'pen') return;
      const pressure = e.buttons > 0 && e.pressure > 0 && e.pressure !== 0.5;
      setTablet((t) => (t.seen && (t.pressure || !pressure) ? t : { seen: true, pressure: t.pressure || pressure }));
    };
    window.addEventListener('pointerdown', seen);
    window.addEventListener('pointermove', seen);
    return () => {
      window.removeEventListener('pointerdown', seen);
      window.removeEventListener('pointermove', seen);
    };
  }, []);

  // Attach pen input once the board is up and we are confirmed as the teacher.
  const canWrite = room.welcome?.canWrite ?? false;
  useEffect(() => {
    if (!renderer || !canWrite || mode !== 'board') return;
    // Right after switching from the 3D room, the 3D board's renderer may still be
    // current for a moment; wait for the flat board's own renderer.
    const host = renderer.live.parentElement;
    if (!host || !host.isConnected) return;
    const pi = new PenInput(host, room.board, renderer, () => penRef.current);
    pi.onHistory = (u, r) => setHist({ undo: u, redo: r });
    setInput(pi);
    let t = 0;
    const down = () => {
      clearTimeout(t);
      setWriting(true);
      setPanel(null);
    };
    const up = () => {
      clearTimeout(t);
      t = window.setTimeout(() => setWriting(false), 900);
    };
    host.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    return () => {
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      pi.destroy();
      setInput(null);
    };
  }, [renderer, canWrite, room.board, mode]);

  const goPage = (p: number) => room.board.local({ t: 'pg', pg: p });
  const newPage = () => room.board.local({ t: 'pn' });

  // Keyboard shortcuts — most tablets map their express keys to these.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if (walking) return; // keys move the teacher while walking
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        e.shiftKey ? input?.redo() : input?.undo();
      } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
        e.preventDefault();
        input?.redo();
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (KEY_TOOLS[k]) {
        setPen((p) => ({ ...p, tool: KEY_TOOLS[k] }));
      } else if (k >= '1' && k <= '5') {
        setPen((p) => ({ ...p, color: KEY_COLORS[Number(k) - 1], tool: p.tool === 'eraser' ? 'pen' : p.tool }));
      } else if (k === 'n') {
        newPage();
      } else if (k === 'pagedown' || k === 'arrowright') {
        if (pg.live < pg.pages - 1) goPage(pg.live + 1);
      } else if (k === 'pageup' || k === 'arrowleft') {
        if (pg.live > 0) goPage(pg.live - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, pg.live, pg.pages, walking]);

  const me = room.welcome?.me.uid;
  const otherOf = (m: { from: string; to: string }) => (m.from === me ? m.to : m.from);
  const unread = useUnread(room.chats, me, otherOf, panel === 'chat' ? thread : null);
  const threads = useMemo(() => {
    // Everyone in class, plus anyone who wrote and has since left; latest message first.
    const last = new Map<string, number>();
    for (const m of room.chats) last.set(otherOf(m), m.at);
    const names = new Map(room.roster.map((r) => [r.uid, r.name]));
    for (const m of room.chats) if (m.from !== me && !names.has(m.from)) names.set(m.from, m.fromName);
    return [...names.entries()]
      .map(([uid, name]) => ({ uid, name, online: room.roster.find((r) => r.uid === uid)?.online ?? false, at: last.get(uid) ?? 0 }))
      .sort((a, b) => b.at - a.at || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.chats, room.roster, me]);
  const [pop, setPop] = useState<ChatMessage | null>(null);
  useIncoming(room.chats, me, (m) => {
    if (!(panel === 'chat' && thread === m.from)) setPop(m);
  });
  const isTyping = (uid: string) => (room.typing[uid] ?? 0) > Date.now();
  const chatWith = (uid: string) => {
    setThread(uid);
    setPanel('chat');
  };

  // "Ali Khan joined" — a quiet notice as each student takes a seat.
  const [joined, setJoined] = useState<string[]>([]);
  const seenRef = useRef<Set<string> | null>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    if (room.welcome) openedAt.current = Date.now();
  }, [room.welcome]);
  useEffect(() => {
    const online = room.roster.filter((r) => r.online);
    if (!room.welcome) return;
    // Students already in class when this screen opens are not announced.
    if (!seenRef.current || Date.now() - openedAt.current < 2500) {
      seenRef.current = new Set([...(seenRef.current ?? []), ...online.map((r) => r.uid)]);
      return;
    }
    const fresh = online.filter((r) => !seenRef.current!.has(r.uid));
    for (const r of online) seenRef.current.add(r.uid);
    if (!fresh.length) return;
    const names = fresh.map((r) => r.name);
    setJoined((j) => [...j, ...names].slice(-3));
    const t = window.setTimeout(() => setJoined((j) => j.slice(names.length)), 4000);
    return () => clearTimeout(t);
  }, [room.roster, room.welcome]);

  const hands = useMemo(
    () => room.roster.filter((r) => r.hand && r.online).sort((a, b) => (a.handAt ?? 0) - (b.handAt ?? 0)),
    [room.roster],
  );

  if (ready && !user) {
    return (
      <Lobby>
        <div className="card">
          <div className="brand">
            <span className="brand__mark" />
            <span>
              NET360 <em>Classroom</em>
            </span>
          </div>
          <h1 className="card__title">Open your classroom</h1>
          <SignIn prompt="Sign in with your teacher account." />
        </div>
      </Lobby>
    );
  }

  const info = room.welcome?.session;
  const showJoin = room.cls?.showJoin ?? true;
  const notTeacher = room.welcome && room.welcome.role !== 'teacher';

  const openBoard = async () => {
    if (!sessionId || !boardKey) return;
    const url = boardUrl(sessionId, boardKey);
    window.open(url, 'net360-board');
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2400);
    } catch {
      /* clipboard blocked — the window still opened */
    }
  };

  const body = (
    <>
      <header className="console-bar">
        <div className="console-bar__title">
          <span className="brand__mark" />
          {info ? (
            <span>
              <strong>{info.subject}</strong>
              {info.topic && <span className="muted"> · {info.topic}</span>}
            </span>
          ) : (
            <span className="muted">Opening classroom…</span>
          )}
        </div>
        <div className="console-bar__right">
          {can3d() && (
            <div className="seg" role="tablist" aria-label="View">
              <button className={mode === 'room' && !walking ? 'is-on' : ''} onClick={() => { setMode('room'); setWalking(false); }} title="Write in the 3D classroom">
                <Icon.cube /> Classroom
              </button>
              <button className={mode === 'room' && walking ? 'is-on' : ''} onClick={() => { setMode('room'); setWalking(true); }} title="Walk around the class">
                <Icon.walk /> Walk
              </button>
              <button className={mode === 'board' ? 'is-on' : ''} onClick={() => { setMode('board'); setWalking(false); }} title="Write on the large board">
                <Icon.board /> Board
              </button>
            </div>
          )}
          <StatusPill status={room.status} />
          {tablet.seen && (
            <span className="pill pill--ok" title="Writing tablet connected">
              <Icon.pen /> Tablet
            </span>
          )}
          <span className="pill" title="Students in the classroom">
            <Icon.users /> {room.cls?.present ?? 0}
          </span>
          <button className="btn btn--ghost btn--sm" onClick={() => setConfirmEnd(true)}>
            End class
          </button>
        </div>
      </header>

      <div className={`console ${mode === 'room' ? 'console--3d' : ''}`}>
        <PenDock
          pen={pen}
          setPen={setPen}
          canUndo={hist.undo}
          canRedo={hist.redo}
          onUndo={() => input?.undo()}
          onRedo={() => input?.redo()}
          onClear={() => input?.clearPage()}
          quiet={writing}
        />

        <div className="console__board">
          {mode === 'board' && <Board board={room.board} onRenderer={setRenderer} writable={canWrite} className={`tool-${pen.tool}`} />}
          <div className={`pagebar ${writing ? 'is-quiet' : ''}`}>
            <button aria-label="Previous page" disabled={pg.live === 0} onClick={() => goPage(pg.live - 1)}>
              <Icon.left />
            </button>
            <span>
              Page {pg.live + 1} of {pg.pages}
            </span>
            <button aria-label="Next page" disabled={pg.live >= pg.pages - 1} onClick={() => goPage(pg.live + 1)}>
              <Icon.right />
            </button>
            <span className="pagebar__sep" />
            <button aria-label="New page" title="New page (N)" onClick={newPage}>
              <Icon.plus />
            </button>
            <button aria-label="Save notes" title="Save notes as PDF" onClick={() => saveNotesPdf(room.board.state, info)}>
              <Icon.download />
            </button>
          </div>
        </div>

        <aside className={`rail ${writing ? 'is-quiet' : ''}`} aria-label="Class">
          <button className={`rail__btn ${panel === 'join' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'join' ? null : 'join')} title="Join code">
            <Icon.qr />
            <span>Join</span>
          </button>
          <button className={`rail__btn ${panel === 'class' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'class' ? null : 'class')} title="Your class">
            <span className={`rail__hand ${hands.length ? 'is-up' : ''}`}>
              <Icon.users />
              {hands.length > 0 && <b>{hands.length}</b>}
            </span>
            <span>Class</span>
          </button>
          <button className={`rail__btn ${panel === 'chat' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} title="Message students">
            <span className={`rail__hand ${unread.total ? 'is-up' : ''}`}>
              <Icon.chat />
              {unread.total > 0 && <b>{unread.total}</b>}
            </span>
            <span>Chat</span>
          </button>
          <button className={`rail__btn ${panel === 'pen' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'pen' ? null : 'pen')} title="Writing tablet">
            <span className={`rail__hand ${tablet.seen ? 'is-ok' : ''}`}>
              <Icon.pen />
            </span>
            <span>Pen</span>
          </button>
          <button className="rail__btn" onClick={openBoard} disabled={!boardKey} title="Open the classroom board display">
            <Icon.display />
            <span>{copied ? 'Copied' : 'Board'}</span>
          </button>

          <AnimatePresence>
            {panel === 'pen' && (
              <motion.div className="panel panel--pen" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                <div className={`penstatus ${tablet.seen ? 'is-ok' : ''}`}>
                  <span className="penstatus__dot" />
                  <span>
                    <strong>{tablet.seen ? 'Writing tablet connected' : 'No writing tablet detected yet'}</strong>
                    <small>
                      {tablet.seen
                        ? tablet.pressure
                          ? 'Pen pressure is working — lines get thicker as you press.'
                          : 'Working. Turn on pen pressure in the tablet settings for natural lines.'
                        : 'Touch the pen to the tablet once and this will turn green.'}
                    </small>
                  </span>
                </div>

                <p className="panel__label">Connect a writing tablet</p>
                <ol className="steps">
                  <li>Plug the tablet into this computer (USB or Bluetooth) and install its driver (Wacom, XP-Pen, Huion…).</li>
                  <li>In the tablet settings, map the pen area to <b>this screen</b>, and turn on <b>Windows Ink</b> on Windows.</li>
                  <li>Keep this page open — the pen draws on the board here, and everyone sees it instantly.</li>
                </ol>

                <p className="panel__label">No tablet? Use your phone or iPad</p>
                {padKey && sessionId ? (
                  <div className="padqr">
                    <QR text={padUrl(sessionId, padKey)} size={132} />
                    <p className="small">Scan with your phone or iPad and write with a finger or stylus. Only you have this code — don't show it to students.</p>
                  </div>
                ) : (
                  <p className="muted small">Preparing your pad link…</p>
                )}
                <p className="panel__label">Or simply</p>
                <p className="small">Write with the mouse, a touchscreen, or a laptop pen right on the board.</p>
              </motion.div>
            )}
            {panel === 'chat' && (
              <motion.div className="panel panel--chat" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                {thread ? (
                  <>
                    <div className="drawer__head">
                      <button aria-label="All students" onClick={() => setThread(null)}>
                        <Icon.left />
                      </button>
                      <span>
                        <strong>{threads.find((t) => t.uid === thread)?.name ?? 'Student'}</strong>
                        <small>{isTyping(thread) ? 'typing…' : threads.find((t) => t.uid === thread)?.online ? 'In class' : 'Left the class'}</small>
                      </span>
                    </div>
                    <ChatThread
                      messages={room.chats.filter((m) => otherOf(m) === thread)}
                      me={me}
                      placeholder="Write a private message…"
                      empty="Only this student will see your message."
                      autoFocus
                      seenAt={me ? room.seen[`${thread}|${me}`] ?? 0 : 0}
                      typing={isTyping(thread)}
                      typingLabel={threads.find((t) => t.uid === thread)?.name ?? 'Student'}
                      onSend={(text) => room.sendChat(text, thread)}
                      onRetry={room.retryChat}
                      onTyping={() => room.sendTyping(thread)}
                      onSeen={(at) => room.markSeen(at, thread)}
                    />
                  </>
                ) : (
                  <>
                    <p className="panel__label">Message a student</p>
                    {threads.length === 0 ? (
                      <p className="muted small">Students appear here as they join.</p>
                    ) : (
                      <ul className="threads">
                        {threads.map((t) => (
                          <li key={t.uid}>
                            <button onClick={() => setThread(t.uid)}>
                              <span className={`threads__dot ${t.online ? 'is-on' : ''}`} />
                              <span className="threads__name">
                                {t.name}
                                {isTyping(t.uid) && <small className="threads__typing">typing…</small>}
                              </span>
                              {unread.by[t.uid] ? <b>{unread.by[t.uid]}</b> : null}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </motion.div>
            )}
            {panel === 'join' && info && (
              <motion.div className="panel" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                <p className="panel__label">Students join with</p>
                <QR text={joinUrl(info.code)} size={176} />
                <Code code={info.code} />
                <label className="toggle">
                  <input type="checkbox" checked={showJoin} onChange={(e) => room.socket?.emit('cls', { showJoin: e.target.checked })} />
                  <span>Show on classroom board</span>
                </label>
              </motion.div>
            )}
            {panel === 'class' && (
              <motion.div className="panel panel--class" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                {can3d() && (
                  <div className="classview">
                    <Suspense fallback={null}>
                      <Classroom3D view="classview" people={room.people} teacherName={null} showNames />
                    </Suspense>
                    {room.people.length === 0 && <p className="classview__empty">Students appear at their desks as they join</p>}
                  </div>
                )}
                <p className="panel__label">Raised hands</p>
                {hands.length === 0 ? (
                  <p className="muted small">No hands up right now.</p>
                ) : (
                  <ol className="hands">
                    {hands.map((h) => (
                      <li key={h.uid}>
                        <span>{h.name}</span>
                        <button className="btn btn--ghost btn--sm" onClick={() => room.socket?.emit('lower', h.uid)}>
                          <Icon.check /> Done
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="panel__label panel__label--gap">In class · {room.roster.filter((r) => r.online).length}</p>
                <ul className="roster">
                  {room.roster
                    .filter((r) => r.online)
                    .map((r) => (
                      <li key={r.uid}>
                        <button className="roster__btn" onClick={() => chatWith(r.uid)} title={`Message ${r.name}`}>
                          <span>{r.name}</span>
                          <Icon.chat />
                        </button>
                      </li>
                    ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>

      {(notTeacher || room.status === 'error' || room.status === 'ended') && (
        <div className="veil">
          <div className="veil__card">
            <h2>{room.status === 'ended' ? 'Class ended' : notTeacher ? 'This is not your class' : 'Could not open the class'}</h2>
            <p>
              {room.status === 'ended'
                ? 'Save the notes before you leave.'
                : notTeacher
                  ? 'Only the teacher who started this class can write on its board.'
                  : friendly(room.error, 'teacher')}
            </p>
            {room.status === 'ended' && (
              <button className="btn btn--primary btn--wide" onClick={() => saveNotesPdf(room.board.state, info)}>
                Save notes as PDF
              </button>
            )}
            <button className="btn btn--ghost btn--wide" onClick={() => nav('/')}>
              Back to start
            </button>
          </div>
        </div>
      )}

      {!(panel === 'chat' && thread === pop?.from) && (
        <ChatPop msg={pop} onClose={() => setPop(null)} onOpen={() => { if (pop) chatWith(pop.from); setPop(null); }} />
      )}

      <div className="joined" aria-live="polite">
        <AnimatePresence>
          {joined.map((n, i) => (
            <motion.div key={`${n}-${i}`} className="joined__item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span className="joined__dot" /> <strong>{n}</strong> joined the class
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {confirmEnd && (
        <div className="veil" onClick={() => setConfirmEnd(false)}>
          <div className="veil__card" onClick={(e) => e.stopPropagation()}>
            <h2>End this class?</h2>
            <p>Students keep the notes written so far. The join code stops working.</p>
            <button
              className="btn btn--primary btn--wide"
              onClick={() => {
                room.socket?.emit('end');
                setConfirmEnd(false);
              }}
            >
              End class
            </button>
            <button className="btn btn--ghost btn--wide" onClick={() => setConfirmEnd(false)}>
              Keep teaching
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (mode === 'room') {
    return (
      <div className={`stage3d stage3d--teacher tool-${pen.tool}`}>
        <Suspense fallback={<div className="stage3d__loading" />}>
          <Classroom3D
            view="teacher"
            board={room.board}
            people={room.people}
            teacherName={info?.teacherName ?? null}
            pen={canWrite ? () => penRef.current : undefined}
            walk={walking}
            onPen={(pi) => {
              setInput(pi);
              if (pi) pi.onHistory = (u, r) => setHist({ undo: u, redo: r });
            }}
            onRenderer={setRenderer}
          />
        </Suspense>
        {body}
        {walking && (
          <div className="walkhint">
            <span>Drag to look around · tap the floor to walk there · W A S D or arrow keys</span>
            <button className="btn btn--sm btn--light" onClick={() => setWalking(false)}>
              Back to the board
            </button>
          </div>
        )}
      </div>
    );
  }
  return <Environment variant="console">{body}</Environment>;
}
