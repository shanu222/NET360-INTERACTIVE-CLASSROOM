import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { INK, PenInput, type BoardRenderer, type PenSettings } from '@net360/board-engine';
import { useClassroom } from '../lib/classroom.ts';
import { usePageInfo, useWakeLock } from '../lib/hooks.ts';
import { Board } from '../components/Board.tsx';
import { PenDock } from '../components/PenDock.tsx';
import { Icon } from '../components/Icons.tsx';
import { StatusPill, friendly } from './Student.tsx';

/**
 * The writing pad: the teacher opens this on a phone or iPad (from the QR code in
 * the console) and writes with a finger or stylus. Everything appears on the
 * classroom board, the 3D room and every student's screen.
 */
export default function Pad() {
  const { sessionId } = useParams();
  const [params] = useSearchParams();
  const room = useClassroom(sessionId, { padKey: params.get('k') ?? undefined });
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const pg = usePageInfo(room.board, renderer);
  const [pen, setPen] = useState<PenSettings>({ tool: 'pen', color: INK.chalk, width: 4.4 });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [input, setInput] = useState<PenInput | null>(null);
  const [hist, setHist] = useState({ undo: false, redo: false });
  useWakeLock(room.status === 'live');
  const canWrite = room.welcome?.canWrite ?? false;

  useEffect(() => {
    if (!renderer || !canWrite) return;
    const pi = new PenInput(renderer.live.parentElement!, room.board, renderer, () => penRef.current);
    pi.onHistory = (u, r) => setHist({ undo: u, redo: r });
    setInput(pi);
    return () => {
      pi.destroy();
      setInput(null);
    };
  }, [renderer, canWrite, room.board]);

  const info = room.welcome?.session;
  return (
    <div className="pad">
      <header className="pad__bar">
        <span className="pad__title">
          <span className="brand__mark" />
          <span>
            <strong>Writing pad</strong>
            {info && <span className="muted"> · {info.subject}</span>}
          </span>
        </span>
        <StatusPill status={room.status} />
      </header>
      <div className="pad__body">
        <PenDock
          pen={pen}
          setPen={setPen}
          canUndo={hist.undo}
          canRedo={hist.redo}
          onUndo={() => input?.undo()}
          onRedo={() => input?.redo()}
          onClear={() => input?.clearPage()}
          quiet={false}
        />
        <div className="pad__board">
          <Board board={room.board} onRenderer={setRenderer} writable={canWrite} className={`tool-${pen.tool}`} />
          <div className="pagebar">
            <button aria-label="Previous page" disabled={pg.live === 0} onClick={() => room.board.local({ t: 'pg', pg: pg.live - 1 })}>
              <Icon.left />
            </button>
            <span>
              Page {pg.live + 1} of {pg.pages}
            </span>
            <button aria-label="Next page" disabled={pg.live >= pg.pages - 1} onClick={() => room.board.local({ t: 'pg', pg: pg.live + 1 })}>
              <Icon.right />
            </button>
            <span className="pagebar__sep" />
            <button aria-label="New page" onClick={() => room.board.local({ t: 'pn' })}>
              <Icon.plus />
            </button>
          </div>
        </div>
      </div>
      <p className="pad__portrait">Turn your device sideways to write.</p>
      {(room.status === 'error' || room.status === 'ended') && (
        <div className="veil">
          <div className="veil__card">
            <h2>{room.status === 'ended' ? 'Class ended' : 'Writing pad not connected'}</h2>
            <p>{room.status === 'ended' ? 'You can close this page.' : friendly(room.error)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
