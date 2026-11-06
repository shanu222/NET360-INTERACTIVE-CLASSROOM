import { Suspense, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { BoardRenderer } from '@net360/board-engine';
import { useAuth } from '../lib/auth.tsx';
import { useClassroom } from '../lib/classroom.ts';
import { useIdle, usePageInfo } from '../lib/hooks.ts';
import { saveNotesPdf } from '../lib/notes.ts';
import { Classroom3D, can3d, prefers3d } from '../lib/webgl.ts';
import { Environment } from '../components/Environment.tsx';
import { Board } from '../components/Board.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Lobby } from '../components/Lobby.tsx';
import { Icon } from '../components/Icons.tsx';
import type { ZoomCommand } from '../three/Classroom3D.tsx';
import { codeFor } from '../lib/code.ts';
import { Navigate } from 'react-router-dom';
import { ChatThread, useUnread } from '../components/Chat.tsx';

/**
 * The student's classroom: the 3D room with the live board, classmates at
 * their desks and the teacher at the front — or just the board, one tap away.
 */
export default function Student() {
  const { sessionId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { ready, user } = useAuth();
  // Students get in with the class code they entered on the join card.
  const code = codeFor(sessionId);
  const room = useClassroom(sessionId, { enabled: Boolean(user && code), as: 'student', code: code ?? undefined });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const idle = useIdle(3200);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [hideHint, setHideHint] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const me = room.welcome?.me.uid;
  const unread = useUnread(room.chats, me, () => 'teacher', chatOpen ? 'teacher' : null);
  const [in3d, setIn3d] = useState(prefers3d);
  // 0 = from my desk, 1 = the board fills the screen
  const [zoomCmd, setZoomCmd] = useState<ZoomCommand>({ t: 0, n: 0 });
  const [atBoard, setAtBoard] = useState(false);
  const zoomTo = (t: number) => setZoomCmd((z) => ({ t, n: z.n + 1 }));
  const entering = Boolean((loc.state as { entering?: boolean } | null)?.entering);

  if (!code) return <Navigate to="/join" replace />;

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
          <h1 className="card__title">Take your seat</h1>
          <SignIn prompt="Sign in to enter the classroom." />
        </div>
      </Lobby>
    );
  }

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
      <header className={`topline ${idle && !menu ? 'is-idle' : ''}`}>
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
              onSend={(text) => room.socket?.emit('chat', { text })}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
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
            initial={entering ? { opacity: 0, scale: 1.08, filter: 'blur(10px)' } : false}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
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
export function friendly(msg: string | null): string {
  if (!msg) return 'Please try again in a moment.';
  if (/sign in/i.test(msg)) return 'Please sign in again to rejoin your class.';
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
