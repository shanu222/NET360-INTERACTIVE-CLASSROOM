import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BoardRenderer, type BoardSession } from '@net360/board-engine';
import { BOARD_TEX, ClassroomScene, type Rect, type View } from './scene.ts';
import type { PersonInRoom } from './people.ts';

/**
 * The 3D classroom. When a board session is given, the live ink is drawn by a
 * hidden BoardRenderer and copied onto the board in the room after each redraw.
 * `children` are placed exactly over the board on screen (QR card, chips, pager).
 */
export default function Classroom3D({
  view,
  board,
  people = [],
  teacherName = null,
  hideUid,
  showNames = false,
  onRenderer,
  children,
  className = '',
}: {
  view: View;
  board?: BoardSession | null;
  people?: PersonInRoom[];
  teacherName?: string | null;
  hideUid?: string;
  showNames?: boolean;
  onRenderer?: (r: BoardRenderer | null) => void;
  children?: ReactNode;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ClassroomScene | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const cb = useRef(onRenderer);
  cb.current = onRenderer;

  // The scene itself.
  useEffect(() => {
    const scene = new ClassroomScene(hostRef.current!, view);
    scene.onBoardRect = setRect;
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [view]);

  // The live board, drawn off-screen at texture size and copied into the room.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !board) return;
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      width: `${BOARD_TEX.w}px`,
      height: `${BOARD_TEX.h}px`,
      pointerEvents: 'none',
      visibility: 'hidden',
    });
    document.body.appendChild(host);
    const r = new BoardRenderer(host, board, { dpr: 1 });
    r.onFrame = () => scene.boardChanged();
    scene.setBoardSource({ committed: r.committed, live: r.live });
    cb.current?.(r);
    return () => {
      cb.current?.(null);
      scene.setBoardSource(null);
      r.destroy();
      host.remove();
    };
  }, [board, view]);

  useEffect(() => {
    sceneRef.current?.setPeople(people, teacherName, hideUid);
  }, [people, teacherName, hideUid, view]);

  useEffect(() => {
    sceneRef.current?.setShowNames(showNames);
  }, [showNames, view]);

  return (
    <div className={`room3d ${className}`} ref={hostRef}>
      {rect && children && (
        <div
          className="room3d__board"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
