import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { INK, type BoardRenderer, type PenInput, type PenSettings } from '@net360/board-engine';
import { useAuth } from '../lib/auth.tsx';
import { useClassroom } from '../lib/classroom.ts';
import { api, boardUrl, joinUrl, padUrl } from '../lib/api.ts';
import { saveNotesPdf } from '../lib/notes.ts';
import { Environment } from '../components/Environment.tsx';
import { ModeBar, Stage, useBoardView } from '../components/Stage.tsx';
import { SLIDE_TYPES } from '../lib/slides.ts';
import { PenDock } from '../components/PenDock.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Code, QR } from '../components/QR.tsx';
import { Icon } from '../components/Icons.tsx';
import { StatusPill, friendly } from './Student.tsx';
import { words } from '../lib/words.ts';
import { Classroom3D, can3d, prefers3d, roomStudents } from '../lib/webgl.ts';
import { Lobby } from '../components/Lobby.tsx';
import { ChatPop, ChatThread, useIncoming, useUnread } from '../components/Chat.tsx';
import { useClassAudio } from '../lib/audio.ts';
import { AddSlides, ScreenStage, useSlideUpload } from '../components/Present.tsx';
import { canSpeak } from '@net360/protocol';
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
  const [, setRenderer] = useState<BoardRenderer | null>(null);
  const view = useBoardView(room.board);
  const [pen, setPen] = useState<PenSettings>({ tool: 'pen', color: INK.chalk, width: 4.4 });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [input, setInput] = useState<PenInput | null>(null);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const [writing, setWriting] = useState(false);
  const [panel, setPanel] = useState<'join' | 'class' | 'pen' | 'chat' | 'present' | null>(() => {
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
  const [mode, setMode] = useState<'room' | 'board'>(() => (prefers3d() ? 'room' : 'board'));
  // Walking around the 3D classroom (writing pauses while walking).
  const [walking, setWalking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
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

  const canWrite = room.welcome?.canWrite ?? false;
  // Writing: the rail and page bar fade while the pen is down.
  const penUp = useRef(0);
  const penDown = () => {
    clearTimeout(penUp.current);
    setWriting(true);
    setPanel(null);
  };
  useEffect(() => {
    const up = () => {
      clearTimeout(penUp.current);
      penUp.current = window.setTimeout(() => setWriting(false), 900);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);
  // Side by side needs the flat board (the classroom has one board).
  useEffect(() => {
    if (view.mode === 'split' && mode === 'room') {
      setMode('board');
      setWalking(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.mode]);

  const goPage = (p: number | undefined) => p !== undefined && room.board.local({ t: 'pg', pg: p });
  const newPage = () => room.board.local({ t: 'pn' });
  /** Next / previous slide, or whiteboard page on the whiteboard. */
  const step = (d: 1 | -1) => {
    const list = view.mode === 'board' ? view.boards : view.slides;
    const cur = view.mode === 'board' ? view.wb : view.slide;
    goPage(list[list.indexOf(cur ?? -1) + d]);
  };
  const slideFile = useRef<HTMLInputElement>(null);

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
      } else if (k === 'f') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      } else if (k === 'b') {
        room.board.local({ t: 'md', m: 'board' });
      } else if (k === 's') {
        room.board.local({ t: 'md', m: 'slides' });
      } else if (k === 'd') {
        room.board.local({ t: 'md', m: 'split' });
      } else if (k === 'pagedown' || k === 'arrowright' || k === ' ') {
        if (k === ' ') e.preventDefault();
        step(1);
      } else if (k === 'pageup' || k === 'arrowleft') {
        step(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, view, walking]);

  const me = room.welcome?.me.uid;

  // Class audio: the teacher speaks to everyone and decides who else may speak.
  const sound = useClassAudio(room.socket, room.audio, Boolean(room.welcome) && room.status !== 'ended' && room.status !== 'error');
  const audioOn = sound.status === 'on';
  const slides = useSlideUpload(room.socket, room.board);
  const pres = room.present;
  const onlineStudents = room.roster.filter((r) => r.online);
  // A student's request to present pops up for the teacher.
  const [askPop, setAskPop] = useState<{ uid: string; name: string } | null>(null);
  const seenAsks = useRef(new Set<string>());
  useEffect(() => {
    const reqs = pres?.requests ?? [];
    const fresh = reqs.find((r) => !seenAsks.current.has(r.uid));
    seenAsks.current = new Set(reqs.map((r) => r.uid));
    if (fresh && panel !== 'present') setAskPop(fresh);
    if (askPop && !reqs.some((r) => r.uid === askPop.uid)) setAskPop(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pres?.requests]);
  useEffect(() => {
    if (slides.error) setAudioNote(slides.error);
  }, [slides.error]);
  const speakers = room.audio ? room.roster.filter((r) => r.online && canSpeak(room.audio!, r.uid)) : [];
  const letSpeak = (uid: string, allow: boolean) => room.socket?.emit('allowSpeak', { uid, allow });
  const [audioNote, setAudioNote] = useState('');
  useEffect(() => {
    if (!sound.micError) return;
    setAudioNote(sound.micError);
    const t = window.setTimeout(() => setAudioNote(''), 5000);
    return () => clearTimeout(t);
  }, [sound.micError]);
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
              Meeto<em>360</em>
            </span>
          </div>
          <h1 className="card__title">Sign in to host</h1>
          <SignIn prompt="Sign in with the account that created this meeting or class." />
        </div>
      </Lobby>
    );
  }

  const info = room.welcome?.session;
  const w = words(info?.kind);
  const showJoin = room.cls?.showJoin ?? true;
  const notTeacher = room.welcome && room.welcome.role !== 'teacher';

  const openBoard = async () => {
    if (!sessionId || !boardKey) return;
    const url = boardUrl(sessionId, boardKey);
    window.open(url, 'meeto360-board');
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
              <button className={mode === 'room' && !walking ? 'is-on' : ''} onClick={() => { setMode('room'); setWalking(false); }} title="Write in the 3D room">
                <Icon.cube /> <span>Room</span>
              </button>
              <button className={mode === 'room' && walking ? 'is-on' : ''} onClick={() => { setMode('room'); setWalking(true); }} title="Walk around the room">
                <Icon.walk /> <span>Walk</span>
              </button>
              <button className={mode === 'board' ? 'is-on' : ''} onClick={() => { setMode('board'); setWalking(false); }} title="Write on the large board">
                <Icon.board /> <span>Board</span>
              </button>
            </div>
          )}
          {room.audio?.available && (
            <button
              className={`micbtn ${sound.micOn ? 'is-live' : ''} ${sound.micOn && me && sound.speaking.has(me) ? 'is-talking' : ''}`}
              disabled={!audioOn || sound.micBusy}
              aria-pressed={sound.micOn}
              onClick={() => void sound.setMic(!sound.micOn)}
              title={sound.micOn ? 'Everyone can hear you — click to mute' : 'Turn your microphone on so everyone can hear you'}
            >
              {sound.micOn ? <Icon.mic /> : <Icon.micOff />}
              <span>{!audioOn ? 'Connecting…' : sound.micBusy ? (sound.micOn ? 'Turning off…' : 'Turning on…') : sound.micOn ? 'On air' : 'Mic off'}</span>
            </button>
          )}
          {audioOn && speakers.length > 0 && (
            <button className="btn btn--ghost btn--sm btn--muteall" onClick={() => room.socket?.emit('muteAll')} title="Turn off every participant's microphone">
              <Icon.micOff /> <span>Mute all</span>
            </button>
          )}
          {sound.sharing && (
            <button className="micbtn is-live" onClick={() => void sound.shareScreen(false)} title="Stop sharing your screen">
              <Icon.screen /> <span>Sharing · Stop</span>
            </button>
          )}
          <StatusPill status={room.status} />
          {tablet.seen && (
            <span className="pill pill--ok" title="Writing tablet connected">
              <Icon.pen /> Tablet
            </span>
          )}
          <span className="pill" title="Participants">
            <Icon.users /> {room.cls?.present ?? 0}
          </span>
          <button className="btn btn--ghost btn--sm btn--end" onClick={() => setConfirmEnd(true)}>
            End<span>&nbsp;{w.thing}</span>
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
          {mode === 'board' && (
            <div className="console__stage">
              <Stage
                board={room.board}
                view={view}
                pen={canWrite ? () => penRef.current : undefined}
                boardClass={`tool-${pen.tool}`}
                onInput={setInput}
                onHistory={(u, r) => setHist({ undo: u, redo: r })}
                onPenDown={penDown}
                onRenderer={setRenderer}
                showFull={false}
              />
            </div>
          )}
          <input
            ref={slideFile}
            type="file"
            accept={SLIDE_TYPES}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void slides.add(f);
            }}
          />
          <ModeBar
            board={room.board}
            view={view}
            quiet={writing}
            onAddSlides={() => slideFile.current?.click()}
            extra={
              <div className="modebar__nav">
                {slides.progress && (
                  <span className="modebar__busy">
                    {slides.progress.step === 'read' ? 'Preparing' : 'Sending'} {slides.progress.done}/{slides.progress.total}…
                  </span>
                )}
                <button aria-label="Save notes" title="Save notes as PDF" onClick={() => saveNotesPdf(room.board.state, info)}>
                  <Icon.download />
                </button>
                {document.fullscreenEnabled && (
                  <button
                    aria-label="Full screen"
                    title="Full screen (F)"
                    onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen().catch(() => undefined))}
                  >
                    <Icon.fullscreen />
                  </button>
                )}
              </div>
            }
          />
        </div>

        <aside className={`rail ${writing ? 'is-quiet' : ''}`} aria-label="Class">
          <button className={`rail__btn ${panel === 'join' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'join' ? null : 'join')} title="Invite people">
            <Icon.qr />
            <span>Invite</span>
          </button>
          <button className={`rail__btn ${panel === 'class' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'class' ? null : 'class')} title="Participants, raised hands and audio">
            <span className={`rail__hand ${hands.length ? 'is-up' : ''}`}>
              <Icon.users />
              {hands.length > 0 && <b>{hands.length}</b>}
            </span>
            <span>People</span>
          </button>
          <button className={`rail__btn ${panel === 'chat' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'chat' ? null : 'chat')} title="Message participants">
            <span className={`rail__hand ${unread.total ? 'is-up' : ''}`}>
              <Icon.chat />
              {unread.total > 0 && <b>{unread.total}</b>}
            </span>
            <span>Chat</span>
          </button>
          <button className={`rail__btn ${panel === 'present' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'present' ? null : 'present')} title="Share your screen or slides">
            <span className={`rail__hand ${pres?.requests.length ? 'is-up' : ''}`}>
              <Icon.screen />
              {pres?.requests.length ? <b>{pres.requests.length}</b> : null}
            </span>
            <span>Present</span>
          </button>
          <button className={`rail__btn ${panel === 'pen' ? 'is-on' : ''}`} onClick={() => setPanel(panel === 'pen' ? null : 'pen')} title="Writing tablet">
            <span className={`rail__hand ${tablet.seen ? 'is-ok' : ''}`}>
              <Icon.pen />
            </span>
            <span>Pen</span>
          </button>
          <button className="rail__btn" onClick={openBoard} disabled={!boardKey} title="Open the room screen for a TV or projector (link copied)">
            <Icon.display />
            <span>{copied ? 'Copied' : 'Screen'}</span>
          </button>

          <AnimatePresence>
            {panel === 'present' && (
              <motion.div className="panel panel--present" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                <p className="panel__label">Present to everyone</p>
                {sound.status === 'on' && sound.canShare && (
                  <button
                    className={`btn ${sound.sharing ? 'btn--danger' : 'btn--primary'} btn--wide`}
                    disabled={sound.shareBusy}
                    onClick={() => void sound.shareScreen(!sound.sharing)}
                  >
                    <Icon.screen /> {sound.sharing ? 'Stop sharing' : 'Share your screen'}
                  </button>
                )}
                <AddSlides upload={slides} className="btn btn--ghost btn--wide" />
                <p className="muted small">
                  Slides open large for everyone, and you can write on them. Switch between Whiteboard, Slides and Side by side under the board. From PowerPoint or Google Slides, save as PDF first.
                </p>

                <p className="panel__label panel__label--gap">Participants presenting</p>
                {pres?.presenter ? (
                  <div className="presenter">
                    <span className="presenter__dot" />
                    <span className="presenter__name">{pres.presenterName ?? 'A participant'} is presenting</span>
                    <button className="btn btn--ghost btn--sm" onClick={() => room.socket?.emit('presentSet', null)}>
                      Stop
                    </button>
                  </div>
                ) : (
                  <p className="muted small">Only you can present. Let a participant present below.</p>
                )}
                {pres?.requests.length ? (
                  <ul className="asks">
                    {pres.requests.map((r) => (
                      <li key={r.uid}>
                        <span>{r.name} asks to present</span>
                        <button className="btn btn--primary btn--sm" onClick={() => room.socket?.emit('presentSet', r.uid)}>
                          Allow
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => room.socket?.emit('presentDecline', r.uid)}>
                          Not now
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {onlineStudents.length > 0 && (
                  <label className="pickpresenter">
                    <span>Let a participant present</span>
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) room.socket?.emit('presentSet', e.target.value);
                      }}
                    >
                      <option value="">Choose a participant…</option>
                      {onlineStudents.map((r) => (
                        <option key={r.uid} value={r.uid}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </motion.div>
            )}
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
                    <p className="small">Scan with your phone or iPad and write with a finger or stylus. Only you have this code — don't share it with participants.</p>
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
                      <button aria-label="All participants" onClick={() => setThread(null)}>
                        <Icon.left />
                      </button>
                      <span>
                        <strong>{threads.find((t) => t.uid === thread)?.name ?? 'Participant'}</strong>
                        <small>{isTyping(thread) ? 'typing…' : threads.find((t) => t.uid === thread)?.online ? `In the ${w.thing}` : `Left the ${w.thing}`}</small>
                      </span>
                    </div>
                    <ChatThread
                      messages={room.chats.filter((m) => otherOf(m) === thread)}
                      me={me}
                      placeholder="Write a private message…"
                      empty="Only this person will see your message."
                      autoFocus
                      seenAt={me ? room.seen[`${thread}|${me}`] ?? 0 : 0}
                      typing={isTyping(thread)}
                      typingLabel={threads.find((t) => t.uid === thread)?.name ?? 'Participant'}
                      onSend={(text) => room.sendChat(text, thread)}
                      onRetry={room.retryChat}
                      onTyping={() => room.sendTyping(thread)}
                      onSeen={(at) => room.markSeen(at, thread)}
                    />
                  </>
                ) : (
                  <>
                    <p className="panel__label">Message a participant</p>
                    {threads.length === 0 ? (
                      <p className="muted small">Participants appear here as they join.</p>
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
                <p className="panel__label">Share this code to invite people</p>
                <QR text={joinUrl(info.code)} size={176} />
                <Code code={info.code} />
                <button
                  className="btn btn--primary btn--wide"
                  onClick={async () => {
                    const url = joinUrl(info.code);
                    const text = `Join my ${w.thing} “${info.subject}” on Meeto360\n${url}\nCode: ${info.code}`;
                    try {
                      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: info.subject, text });
                      else {
                        await navigator.clipboard.writeText(text);
                        setInviteCopied(true);
                        setTimeout(() => setInviteCopied(false), 2200);
                      }
                    } catch {
                      /* share closed */
                    }
                  }}
                >
                  {inviteCopied ? <><Icon.check /> Invite copied</> : 'Copy invite'}
                </button>
                <label className="toggle">
                  <input type="checkbox" checked={showJoin} onChange={(e) => room.socket?.emit('cls', { showJoin: e.target.checked })} />
                  <span>Show on the room screen</span>
                </label>
              </motion.div>
            )}
            {panel === 'class' && (
              <motion.div className="panel panel--class" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
                {can3d() && (
                  <div className="classview">
                    <Suspense fallback={null}>
                      <Classroom3D view="classview" students={roomStudents(info?.size, room.people)} people={room.people} teacherName={null} showNames />
                    </Suspense>
                    {room.people.length === 0 && <p className="classview__empty">Participants take a seat as they join</p>}
                  </div>
                )}
                {room.audio?.available && (
                  <div className="audioctl">
                    <p className="panel__label">Audio</p>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={room.audio.open}
                        onChange={(e) => room.socket?.emit('audioOpen', e.target.checked)}
                      />
                      <span className="switch__track" />
                      <span>Participants may turn on their mic</span>
                    </label>
                    <p className="muted small">
                      {room.audio.open
                        ? 'Everyone can speak. Mute anyone below.'
                        : speakers.length
                          ? `${w.count(speakers.length)} invited to speak.`
                          : 'Only you can speak. Invite someone with the mic button.'}
                    </p>
                    <button className="btn btn--ghost btn--sm" disabled={!speakers.length} onClick={() => room.socket?.emit('muteAll')}>
                      <Icon.micOff /> Mute everyone
                    </button>
                  </div>
                )}
                <p className="panel__label panel__label--gap">Raised hands</p>
                {hands.length === 0 ? (
                  <p className="muted small">No hands up right now.</p>
                ) : (
                  <ol className="hands">
                    {hands.map((h) => (
                      <li key={h.uid}>
                        <span>{h.name}</span>
                        {room.audio?.available && !canSpeak(room.audio, h.uid) && (
                          <button className="btn btn--ghost btn--sm" onClick={() => letSpeak(h.uid, true)} title={`Let ${h.name} speak`}>
                            <Icon.mic /> Let speak
                          </button>
                        )}
                        <button className="btn btn--ghost btn--sm" onClick={() => room.socket?.emit('lower', h.uid)}>
                          <Icon.check /> Done
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="panel__label panel__label--gap">Participants · {room.roster.filter((r) => r.online).length}</p>
                <ul className="roster">
                  {room.roster
                    .filter((r) => r.online)
                    .map((r) => (
                      <li key={r.uid} className={sound.speaking.has(r.uid) ? 'is-talking' : ''}>
                        <button className="roster__btn" onClick={() => chatWith(r.uid)} title={`Message ${r.name}`}>
                          <span>{r.name}</span>
                          <Icon.chat />
                        </button>
                        {room.audio?.available && (
                          <button
                            className={`roster__mic ${canSpeak(room.audio, r.uid) ? 'is-allowed' : ''}`}
                            onClick={() => letSpeak(r.uid, !canSpeak(room.audio!, r.uid))}
                            title={canSpeak(room.audio, r.uid) ? `Mute ${r.name}` : `Let ${r.name} speak`}
                            aria-label={canSpeak(room.audio, r.uid) ? `Mute ${r.name}` : `Let ${r.name} speak`}
                          >
                            {canSpeak(room.audio, r.uid) ? <Icon.mic /> : <Icon.micOff />}
                          </button>
                        )}
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
            <h2>{room.status === 'ended' ? `${w.Thing} ended` : notTeacher ? `You’re not the host of this ${w.thing}` : `Could not open the ${w.thing}`}</h2>
            <p>
              {room.status === 'ended'
                ? 'Save the notes before you leave.'
                : notTeacher
                  ? `Only the host who created this ${w.thing} can run it. Sign in with that account, or join with the code.`
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

      <AnimatePresence>
        {audioNote && (
          <motion.div className="toast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {audioNote}
          </motion.div>
        )}
      </AnimatePresence>

      {sound.screen && (
        <ScreenStage
          screen={sound.screen}
          onStop={sound.screen.uid === pres?.presenter ? () => room.socket?.emit('presentSet', null) : undefined}
        />
      )}

      <AnimatePresence>
        {askPop && (
          <motion.div className="askpop" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Icon.screen />
            <span>
              <strong>{askPop.name}</strong> asks to present
            </span>
            <button
              className="btn btn--primary btn--sm"
              onClick={() => {
                room.socket?.emit('presentSet', askPop.uid);
                setAskPop(null);
              }}
            >
              Allow
            </button>
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => {
                room.socket?.emit('presentDecline', askPop.uid);
                setAskPop(null);
              }}
            >
              Not now
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="joined" aria-live="polite">
        <AnimatePresence>
          {joined.map((n, i) => (
            <motion.div key={`${n}-${i}`} className="joined__item" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <span className="joined__dot" /> <strong>{n}</strong> joined
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {confirmEnd && (
        <div className="veil" onClick={() => setConfirmEnd(false)}>
          <div className="veil__card" onClick={(e) => e.stopPropagation()}>
            <h2>End this {w.thing} for everyone?</h2>
            <p>Participants keep the notes written so far. The code stops working.</p>
            <button
              className="btn btn--primary btn--wide"
              onClick={() => {
                room.socket?.emit('end');
                setConfirmEnd(false);
              }}
            >
              End for everyone
            </button>
            <button className="btn btn--ghost btn--wide" onClick={() => setConfirmEnd(false)}>
              Cancel
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
            students={roomStudents(info?.size, room.people)}
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
