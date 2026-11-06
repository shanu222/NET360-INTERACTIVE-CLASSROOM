import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { BoardRenderer } from '@net360/board-engine';
import { useClassroom } from '../lib/classroom.ts';
import { useIdle, usePageInfo, useWakeLock } from '../lib/hooks.ts';
import { joinUrl } from '../lib/api.ts';
import { Environment } from '../components/Environment.tsx';
import { Board } from '../components/Board.tsx';
import { Code, QR } from '../components/QR.tsx';
import { Icon } from '../components/Icons.tsx';

/**
 * The classroom TV / projector. Display only: it follows the teacher and has
 * no controls beyond a full-screen button that appears on mouse movement.
 */
export default function BoardDisplay() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const room = useClassroom(sessionId, { boardKey: params.get('k') ?? undefined });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const idle = useIdle(2500);
  useWakeLock(room.status === 'live');
  const info = room.welcome?.session;
  const present = room.cls?.present ?? 0;
  const showJoin = (room.cls?.showJoin ?? true) && room.status !== 'ended';
  // Before anything is written the join card takes centre stage; afterwards it moves to a corner.
  const big = pg.inked === 0 && pg.pages === 1;

  return (
    <Environment variant="display">
      <header className="display-title">
        {info && (
          <>
            <span className="display-title__subject">{info.subject}</span>
            {info.topic && <span className="display-title__topic">{info.topic}</span>}
          </>
        )}
        {room.status === 'live' && (
          <span className="pill pill--live">
            <span className="live-dot" /> LIVE
          </span>
        )}
        {room.status === 'reconnecting' && <span className="pill pill--wait">Reconnecting…</span>}
      </header>

      <Board board={room.board} onRenderer={setRenderer}>
        <AnimatePresence>
          {showJoin && info && (
            <motion.div
              key={big ? 'big' : 'corner'}
              className={`joincard ${big ? 'joincard--big' : 'joincard--corner'}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            >
              <QR text={joinUrl(info.code)} size={big ? 260 : 132} />
              <div className="joincard__text">
                {big && <p className="joincard__eyebrow">Join the class</p>}
                <Code code={info.code} />
                <p className="joincard__hint">
                  {big ? 'Scan with your phone camera, or open NET360 and enter the code.' : 'Scan to join'}
                </p>
                {big && (
                  <p className="joincard__count">
                    {present === 0 ? 'Waiting for the first student…' : `${present} ${present === 1 ? 'student' : 'students'} inside`}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {pg.pages > 1 && <span className="board-page">{pg.page + 1} / {pg.pages}</span>}
      </Board>

      {room.status === 'ended' && <div className="display-end">Class has ended · Notes are saved on every student's device</div>}
      {room.status === 'error' && (
        <div className="veil">
          <div className="veil__card">
            <h2>Board not connected</h2>
            <p>{room.error}</p>
          </div>
        </div>
      )}

      <button
        className={`fs-btn ${idle ? 'is-idle' : ''}`}
        onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
        aria-label="Full screen"
      >
        <Icon.expand /> Full screen
      </button>
    </Environment>
  );
}
