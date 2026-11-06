import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { BoardRenderer } from '@net360/board-engine';
import { useAuth } from '../lib/auth.tsx';
import { useClassroom } from '../lib/classroom.ts';
import { useIdle, usePageInfo } from '../lib/hooks.ts';
import { saveNotesPdf } from '../lib/notes.ts';
import { Environment } from '../components/Environment.tsx';
import { Board } from '../components/Board.tsx';
import { SignIn } from '../components/SignIn.tsx';
import { Icon } from '../components/Icons.tsx';

/**
 * The student's classroom: the live board and almost nothing else.
 * One floating control (raise hand), one quiet menu (save notes),
 * and a "Back to live" chip if they browse earlier pages.
 */
export default function Student() {
  const { sessionId } = useParams();
  const loc = useLocation();
  const nav = useNavigate();
  const { ready, user } = useAuth();
  const room = useClassroom(sessionId, { enabled: Boolean(user) });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const idle = useIdle(3200);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState('');
  const [hideHint, setHideHint] = useState(false);
  const entering = Boolean((loc.state as { entering?: boolean } | null)?.entering);

  if (ready && !user) {
    return (
      <div className="lobby">
        <div className="lobby__card">
          <SignIn prompt="Sign in to enter the classroom." />
        </div>
      </div>
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

  return (
    <Environment variant="full" entering={entering}>
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
      </header>

      <Board board={room.board} onRenderer={setRenderer}>
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
      </Board>
      {!hideHint && (
        <button className="rotate-hint" onClick={() => setHideHint(true)}>
          <Icon.rotate /> Turn your phone sideways for a bigger board
        </button>
      )}

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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <motion.button
          className={`fab fab--hand ${room.hand ? 'is-up' : ''}`}
          whileTap={{ scale: 0.92 }}
          aria-pressed={room.hand}
          aria-label={room.hand ? 'Lower hand' : 'Raise hand'}
          onClick={() => {
            room.socket?.emit('hand', !room.hand);
            if (!room.hand) flash('The teacher can see your hand');
          }}
        >
          <Icon.hand />
          <span>{room.hand ? 'Hand raised' : 'Raise hand'}</span>
        </motion.button>
      </div>

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
            <h2>{room.status === 'ended' ? 'Class has ended' : 'Could not join'}</h2>
            <p>{room.status === 'ended' ? 'Your notes from today are ready to keep.' : room.error}</p>
            {room.status === 'ended' && (
              <button className="btn btn--primary btn--wide" onClick={save}>
                Save notes as PDF
              </button>
            )}
            <button className="btn btn--ghost btn--wide" onClick={() => nav('/')}>
              Leave
            </button>
          </div>
        </div>
      )}
    </Environment>
  );
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
