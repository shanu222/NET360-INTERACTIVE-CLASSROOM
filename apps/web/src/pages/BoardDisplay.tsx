import { Suspense, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import type { BoardRenderer } from '@net360/board-engine';
import { useClassroom } from '../lib/classroom.ts';
import { useIdle, usePageInfo, useWakeLock } from '../lib/hooks.ts';
import { joinUrl } from '../lib/api.ts';
import { Environment } from '../components/Environment.tsx';
import { Classroom3D, can3d, roomStudents } from '../lib/webgl.ts';
import { friendly } from './Student.tsx';
import { Code, QR } from '../components/QR.tsx';
import { Icon } from '../components/Icons.tsx';
import { useClassAudio } from '../lib/audio.ts';
import { ScreenStage } from '../components/Present.tsx';
import { Stage, useBoardView } from '../components/Stage.tsx';

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
  const view = useBoardView(room.board);
  // Slides fill the classroom screen; the 3D room is for the whiteboard.
  const flat = view.mode !== 'board' || !can3d();
  const idle = useIdle(2500);
  useWakeLock(room.status === 'live');
  // The classroom screen shows anyone's shared screen (no sound: the teacher is in the room).
  const media = useClassAudio(room.socket, room.audio, Boolean(room.welcome) && room.status !== 'ended' && room.status !== 'error', { watchOnly: true });
  const info = room.welcome?.session;
  const present = room.cls?.present ?? 0;
  const showJoin = (room.cls?.showJoin ?? true) && room.status !== 'ended';
  // Before anything is written the join card takes centre stage; afterwards it moves to a corner.
  const big = pg.inked === 0 && pg.pages === 1 && view.mode === 'board' && view.slides.length === 0;

  const onBoard: ReactNode = (
    <>
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
              {big && <p className="joincard__eyebrow">Join the {info.kind === 'meeting' ? 'meeting' : 'class'}</p>}
              <Code code={info.code} />
              <p className="joincard__hint">
                {big ? 'Scan with your phone camera, or open Meeto360 and enter the code.' : 'Scan to join'}
              </p>
              {big && (
                <p className="joincard__count">
                  {present === 0 ? 'Waiting for the first participant…' : `${present} ${present === 1 ? 'participant' : 'participants'} joined`}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {view.mode === 'board' && view.boards.length > 1 && (
        <span className="board-page">
          {Math.max(1, view.boards.indexOf(view.wb ?? -1) + 1)} / {view.boards.length}
        </span>
      )}
      {view.mode === 'slides' && <span className="board-page board-page--slide">Slide {view.slides.indexOf(view.slide ?? -1) + 1} / {view.slides.length}</span>}
    </>
  );

  const title = (
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
  );

  return (
    <div className="stage3d stage3d--display">
      {!flat ? (
        <Suspense fallback={<div className="stage3d__loading" />}>
          <Classroom3D view="display" students={roomStudents(info?.size, room.people)} board={room.board} people={room.people} teacherName={info?.teacherName ?? null} onRenderer={setRenderer}>
            {onBoard}
          </Classroom3D>
        </Suspense>
      ) : (
        <Environment variant="display">
          <div className="stagebox stagebox--tv">
            <Stage board={room.board} view={view} overlay={onBoard} onRenderer={setRenderer} showFull={false} />
          </div>
        </Environment>
      )}
      {title}
      {media.screen && <ScreenStage screen={media.screen} tv />}

      {room.status === 'ended' && <div className="display-end">Class has ended · Thank you for joining</div>}
      {room.status === 'error' && (
        <div className="veil">
          <div className="veil__card">
            <h2>Board not connected</h2>
            <p>{friendly(room.error)}</p>
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
    </div>
  );
}
