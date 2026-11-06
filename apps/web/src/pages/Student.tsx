import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { BoardRenderer } from '@net360/board-engine';
import { useClassroom } from '../lib/classroom.ts';
import { useIdle, usePageInfo } from '../lib/hooks.ts';
import { saveNotesPdf } from '../lib/notes.ts';
import { Classroom3D, can3d, prefers3d } from '../lib/webgl.ts';
import { Environment } from '../components/Environment.tsx';
import { Board } from '../components/Board.tsx';
import { Icon } from '../components/Icons.tsx';
import type { ZoomCommand } from '../three/Classroom3D.tsx';
import { codeFor, guestKey, lastName } from '../lib/code.ts';
import { Navigate } from 'react-router-dom';
import { ChatPop, ChatThread, useIncoming, useUnread } from '../components/Chat.tsx';
import { useClassAudio } from '../lib/audio.ts';
import { AddSlides, ScreenStage, SlideNav, useSlideUpload } from '../components/Present.tsx';
import { canSpeak } from '@net360/protocol';
import type { ChatMessage } from '@net360/protocol';

/**
 * The student's classroom: the 3D room with the live board, classmates at
 * their desks and the teacher at the front — or just the board, one tap away.
 */
export default function Student() {
  const { sessionId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  // Students get in with their name and the class code they entered on the join card.
  const code = codeFor(sessionId);
  const [guest] = useState(() => ({ key: guestKey(), name: lastName() }));
  const room = useClassroom(sessionId, { enabled: Boolean(code && guest.name), as: 'student', code: code ?? undefined, guest });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const idle = useIdle(3200);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [hideHint, setHideHint] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [mates, setMates] = useState(false);

  // Class audio: hear the teacher; speak only when the teacher allows it.
  const sound = useClassAudio(room.socket, room.audio, Boolean(room.welcome) && room.status !== 'ended' && room.status !== 'error');
  const mayTalk = Boolean(room.audio && room.welcome && canSpeak(room.audio, room.welcome.me.uid));
  const [invited, setInvited] = useState(false);
  const wasAllowed = useRef(false);
  useEffect(() => {
    if (mayTalk && !wasAllowed.current && sound.status === 'on') setInvited(true);
    if (!mayTalk) setInvited(false);
    wasAllowed.current = mayTalk;
  }, [mayTalk, sound.status]);
  useEffect(() => {
    if (!room.socket) return;
    const s = room.socket;
    const muted = () => flash('Your teacher turned your microphone off');
    s.on('mutedByTeacher', muted);
    return () => {
      s.off('mutedByTeacher', muted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.socket]);
  useEffect(() => {
    if (sound.micError) flash(sound.micError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sound.micError]);
  // Presenting: ask the teacher; once allowed, share a screen or slides.
  const presenting = Boolean(room.present?.presenter && room.present.presenter === room.welcome?.me.uid);
  const [asked, setAsked] = useState(false);
  const slides = useSlideUpload(room.socket, room.board);
  const wasPresenting = useRef(false);
  useEffect(() => {
    if (presenting && !wasPresenting.current) {
      setAsked(false);
      flash('Your teacher lets you present');
    }
    if (!presenting && wasPresenting.current) {
      if (sound.sharing) void sound.shareScreen(false);
      flash('Presenting has ended');
    }
    wasPresenting.current = presenting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting]);
  useEffect(() => {
    if (!room.socket) return;
    const s = room.socket;
    const no = () => {
      setAsked(false);
      flash('Your teacher said not now');
    };
    s.on('presentDeclined', no);
    return () => {
      s.off('presentDeclined', no);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.socket]);
  useEffect(() => {
    if (slides.error) flash(slides.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.error]);
  const askPresent = (on: boolean) => {
    room.socket?.emit('presentAsk', on);
    setAsked(on);
    if (on) flash('Asked your teacher — waiting…');
  };

  const teacherTalking =
    sound.teacherLive && [...sound.speaking].some((id) => id !== room.welcome?.me.uid && !room.people.some((p) => p.uid === id));
  const me = room.welcome?.me.uid;
  const unread = useUnread(room.chats, me, () => 'teacher', chatOpen ? 'teacher' : null);
  const teacherUid = room.chats.find((m) => m.from !== me)?.from ?? room.chats.find((m) => m.from === me && m.to)?.to ?? '';
  const [pop, setPop] = useState<ChatMessage | null>(null);
  useIncoming(room.chats, me, (m) => !chatOpen && setPop(m));
  const [in3d, setIn3d] = useState(prefers3d);
  // 0 = from my desk, 1 = the board fills the screen
  const [zoomCmd, setZoomCmd] = useState<ZoomCommand>({ t: 0, n: 0 });
  const [atBoard, setAtBoard] = useState(false);
  const zoomTo = (t: number) => setZoomCmd((z) => ({ t, n: z.n + 1 }));
  const entering = Boolean((loc.state as { entering?: boolean } | null)?.entering);

  if (!code || !guest.name) return <Navigate to="/join" replace />;

  const info = room.welcome?.session;
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(''), 2600);
  };
  const save = async () => {
    setMenu(false);
    const ok = await saveNotesPdf(room.board.state, info);
    flash(ok ? 'Notes saved' : 'Nothing written yet');
  };

  // Things that sit on the board, in both the 3D and the flat view.
  const onBoard: ReactNode = (
    <>
      <AnimatePresence>
        {!pg.following && (
          <motion.button
            className="chip chip--live"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            onClick={() => renderer?.setViewPage(null)}
          >
            <span className="live-dot" /> Back to live
          </motion.button>
        )}
      </AnimatePresence>
      {pg.pages > 1 && (
        <div className={`pager ${idle ? 'is-idle' : ''}`}>
          <button aria-label="Previous page" disabled={pg.page === 0} onClick={() => renderer?.setViewPage(pg.page - 1)}>
            <Icon.left />
          </button>
          <span>
            {pg.page + 1} / {pg.pages}
          </span>
          <button aria-label="Next page" disabled={pg.page >= pg.pages - 1} onClick={() => renderer?.setViewPage(pg.page + 1)}>
            <Icon.right />
          </button>
        </div>
      )}
    </>
  );

  const controls = (
    <>
      <header className={`topline ${idle && !menu && !mates ? 'is-idle' : ''}`}>
        <span className="topline__title">
          {info ? (
            <>
              <strong>{info.subject}</strong>
              {info.topic && <span> · {info.topic}</span>}
            </>
          ) : (
            'Entering classroom…'
          )}
        </span>
        <StatusPill status={room.status} />
        {sound.teacherLive && (
          <span className={`pill pill--onair ${teacherTalking && sound.heard ? 'is-talking' : ''} ${!sound.heard ? 'is-quiet' : ''}`} title={sound.heard ? 'Your teacher’s microphone is on' : 'Class sound is off on this device'}>
            {sound.heard ? <Icon.mic /> : <Icon.speakerOff />} {!sound.heard ? 'Sound off' : teacherTalking ? 'Teacher speaking' : 'Teacher on air'}
          </span>
        )}
        {room.people.length > 0 && (
          <span className="mates">
            <button className="topline__btn topline__btn--count" onClick={() => setMates((v) => !v)} aria-label="Who is in class" title="Who is in class">
              <Icon.users /> {room.people.length}
            </button>
            <AnimatePresence>
              {mates && (
                <motion.div className="mates__list" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
                  <p className="panel__label">In class · {room.people.length}</p>
                  <ul>
                    {info && (
                      <li className="mates__teacher">
                        {info.teacherName} <small>Teacher</small>
                      </li>
                    )}
                    {[...room.people]
                      .sort((a, b) => a.seat - b.seat)
                      .map((p) => (
                        <li key={p.uid}>
                          {p.name}
                          {p.uid === room.welcome?.me.uid && <small>You</small>}
                          {p.hand && <small className="mates__hand">Hand up</small>}
                          {sound.speaking.has(p.uid) && <small className="mates__talk">Speaking</small>}
                        </li>
                      ))}
                  </ul>
                </motion.div>
              )}
            </AnimatePresence>
          </span>
        )}
        {can3d() && (
          <button className="topline__btn" onClick={() => setIn3d((v) => !v)} aria-label={in3d ? 'Show the board only' : 'Show the classroom'} title={in3d ? 'Board only' : 'Classroom view'}>
            {in3d ? <Icon.board /> : <Icon.cube />}
          </button>
        )}
      </header>

      <div className="float-actions">
        <div className="more">
          <button className={`fab fab--quiet ${idle && !menu ? 'is-idle' : ''}`} aria-label="More" onClick={() => setMenu((m) => !m)}>
            <Icon.more />
          </button>
          <AnimatePresence>
            {menu && (
              <motion.div className="menu" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}>
                <button onClick={save}>
                  <Icon.download /> Save notes as PDF
                </button>
                {can3d() && (
                  <button
                    onClick={() => {
                      setMenu(false);
                      setIn3d((v) => !v);
                    }}
                  >
                    {in3d ? <Icon.board /> : <Icon.cube />} {in3d ? 'Board only' : 'Classroom view'}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {sound.status === 'on' && (
          <button
            className={`fab fab--quiet ${!sound.heard ? 'is-off' : ''} ${idle && !menu && sound.heard ? 'is-idle' : ''}`}
            aria-pressed={!sound.heard}
            aria-label={sound.heard ? 'Silence the class on this device' : 'Hear the class again'}
            title={sound.heard ? 'Silence the class on this device' : 'Hear the class again'}
            onClick={() => {
              sound.setHeard(!sound.heard);
              flash(sound.heard ? 'Class sound off on this device' : 'Class sound on');
            }}
          >
            {sound.heard ? <Icon.speaker /> : <Icon.speakerOff />}
          </button>
        )}
        {sound.status === 'on' && mayTalk && (
          <button
            className={`fab fab--quiet fab--mic ${sound.micOn ? 'is-live' : ''} ${sound.micBusy ? 'is-busy' : ''}`}
            disabled={sound.micBusy}
            aria-pressed={sound.micOn}
            aria-label={sound.micOn ? 'Turn my microphone off' : 'Turn my microphone on'}
            title={sound.micOn ? 'Turn my microphone off' : 'Turn my microphone on'}
            onClick={() => {
              setInvited(false);
              void sound.setMic(!sound.micOn);
            }}
          >
            {sound.micOn ? <Icon.mic /> : <Icon.micOff />}
          </button>
        )}
        {!presenting && (
          <button
            className={`fab fab--quiet ${asked ? 'is-on' : ''} ${idle && !menu && !asked ? 'is-idle' : ''}`}
            aria-label={asked ? 'Cancel your request to present' : 'Ask to present'}
            title={asked ? 'Waiting for your teacher — click to cancel' : 'Ask to present (share your screen or slides)'}
            onClick={() => askPresent(!asked)}
          >
            <Icon.screen />
          </button>
        )}
        <button
          className={`fab fab--quiet fab--chat ${chatOpen ? 'is-on' : ''} ${idle && !menu && !chatOpen && !unread.total ? 'is-idle' : ''}`}
          aria-label="Message your teacher"
          title="Message your teacher"
          onClick={() => setChatOpen((o) => !o)}
        >
          <Icon.chat />
          {unread.total > 0 && <b className="fab__badge">{unread.total}</b>}
        </button>
        <motion.button
          className={`fab fab--hand ${room.hand ? 'is-up' : ''}`}
          whileTap={{ scale: 0.92 }}
          aria-pressed={room.hand}
          aria-label={room.hand ? 'Lower hand' : 'Raise hand'}
          onClick={() => {
            room.socket?.emit('hand', !room.hand);
            if (!room.hand) flash('Your teacher can see your hand');
          }}
        >
          <Icon.hand />
          <span>{room.hand ? 'Hand raised' : 'Raise hand'}</span>
        </motion.button>
      </div>

      <AnimatePresence>
        {sound.status === 'on' && sound.needsTap && sound.heard && (
          <motion.button className="soundtap" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={sound.startSound}>
            <Icon.speaker /> Tap to hear your teacher
          </motion.button>
        )}
        {invited && mayTalk && !sound.micOn && (
          <motion.div className="invite" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Icon.mic />
            <span>Your teacher invited you to speak</span>
            <button
              className="btn btn--primary btn--sm"
              disabled={sound.micBusy}
              onClick={() => {
                setInvited(false);
                void sound.setMic(true);
              }}
            >
              Turn on my mic
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => setInvited(false)}>
              Not now
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {chatOpen && (
          <motion.div className="drawer" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
            <div className="drawer__head">
              <span>
                <strong>{info?.teacherName ?? 'Your teacher'}</strong>
                <small>Only your teacher sees these messages</small>
              </span>
              <button aria-label="Close" onClick={() => setChatOpen(false)}>
                <Icon.close />
              </button>
            </div>
            <ChatThread
              messages={room.chats}
              me={me}
              placeholder="Write to your teacher…"
              empty="Ask a question or say hello."
              autoFocus
              seenAt={teacherUid && me ? room.seen[`${teacherUid}|${me}`] ?? 0 : 0}
              typing={Object.entries(room.typing).some(([, until]) => until > Date.now())}
              typingLabel={info?.teacherName ?? 'Your teacher'}
              onSend={(text) => room.sendChat(text)}
              onRetry={room.retryChat}
              onTyping={() => room.sendTyping()}
              onSeen={(at) => room.markSeen(at)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sound.screen && <ScreenStage screen={sound.screen} />}

      <AnimatePresence>
        {presenting && (
          <motion.div className="presbar" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span className="presbar__live" />
            <strong>You're presenting</strong>
            {sound.status === 'on' && sound.canShare && (
              <button
                className={`btn ${sound.sharing ? 'btn--danger' : 'btn--primary'} btn--sm`}
                disabled={sound.shareBusy}
                onClick={() => void sound.shareScreen(!sound.sharing)}
              >
                <Icon.screen /> {sound.sharing ? 'Stop sharing' : 'Share screen'}
              </button>
            )}
            <AddSlides upload={slides} />
            <SlideNav board={room.board} />
            <button className="btn btn--ghost btn--sm" onClick={() => askPresent(false)}>
              Done
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {!chatOpen && (
        <ChatPop
          msg={pop}
          onClose={() => setPop(null)}
          onOpen={() => {
            setPop(null);
            setChatOpen(true);
          }}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div className={`toast ${presenting ? 'toast--high' : ''}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {(room.status === 'ended' || room.status === 'error') && (
        <div className="veil">
          <div className="veil__card">
            <h2>{room.status === 'ended' ? 'Class has ended' : "Couldn't join the class"}</h2>
            <p>{room.status === 'ended' ? 'Your notes from today are ready to keep.' : friendly(room.error)}</p>
            {room.status === 'ended' && (
              <button className="btn btn--primary btn--wide" onClick={save}>
                Save notes as PDF
              </button>
            )}
            {room.status === 'error' && /sign in|lost the connection/i.test(friendly(room.error) + (room.error ?? '')) && (
              <button className="btn btn--primary btn--wide" onClick={() => window.location.reload()}>
                Try again
              </button>
            )}
            <button className="btn btn--ghost btn--wide" onClick={() => nav(room.status === 'error' ? '/join' : '/')}>
              {room.status === 'error' ? 'Join again' : 'Leave'}
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (in3d) {
    return (
      <div className="stage3d">
        <Suspense fallback={<div className="stage3d__loading" />}>
          <motion.div
            className="stage3d__room"
            initial={entering ? { opacity: 0, scale: 1.08 } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <Classroom3D
              view="student"
              board={room.board}
              people={room.people}
              teacherName={info?.teacherName ?? null}
              hideUid={room.welcome?.me.uid}
              seat={room.people.find((p) => p.uid === room.welcome?.me.uid)?.seat ?? null}
              zoom={zoomCmd}
              onZoom={(t) => setAtBoard(t > 0.5)}
              onRenderer={setRenderer}
            >
              {onBoard}
            </Classroom3D>
          </motion.div>
        </Suspense>
        {controls}
        <div className={`zoombar ${idle ? 'is-idle' : ''}`} role="group" aria-label="View">
          <button className={!atBoard ? 'is-on' : ''} onClick={() => zoomTo(0)}>
            <Icon.desk /> My desk
          </button>
          <button className={atBoard ? 'is-on' : ''} onClick={() => zoomTo(1)}>
            <Icon.zoom /> Board
          </button>
          <span className="zoombar__hint">Drag to look around · scroll or pinch to zoom</span>
        </div>
      </div>
    );
  }

  return (
    <Environment variant="full" entering={entering}>
      <Board board={room.board} onRenderer={setRenderer}>
        {onBoard}
      </Board>
      {!hideHint && (
        <button className="rotate-hint" onClick={() => setHideHint(true)}>
          <Icon.rotate /> Turn your phone sideways for a bigger board
        </button>
      )}
      {controls}
    </Environment>
  );
}

/** Turn server messages into wording students understand. */
export function friendly(msg: string | null, who: 'student' | 'teacher' = 'student'): string {
  if (!msg) return 'Please try again in a moment.';
  if (/wrong class code|class code/i.test(msg)) return 'That code doesn’t match this class. Use the code your teacher shared.';
  if (/your name|join again/i.test(msg)) return 'Please enter your name and the class code again.';
  // Students never sign in; this only appears while the classroom server is updating.
  if (/sign in/i.test(msg)) return who === 'teacher' ? 'Please sign in again to open your class.' : 'Your classroom is getting ready. Please try again in a moment.';
  if (/ended|not exist/i.test(msg)) return 'This class has ended or the code is no longer active.';
  if (/board link/i.test(msg)) return 'This board link has expired. Open it again from the teacher’s screen.';
  return 'We lost the connection to your class. Please try again.';
}

export function StatusPill({ status }: { status: string }) {
  if (status === 'live') {
    return (
      <span className="pill pill--live">
        <span className="live-dot" /> LIVE
      </span>
    );
  }
  if (status === 'reconnecting' || status === 'connecting') {
    return <span className="pill pill--wait">{status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>;
  }
  return null;
}
