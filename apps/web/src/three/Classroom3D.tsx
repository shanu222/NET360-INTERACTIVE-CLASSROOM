import { useEffect, useRef, useState, type ReactNode } from 'react';
import { BoardRenderer, PenInput, type BoardSession, type PenSettings } from '@net360/board-engine';
import { BOARD_TEX, ClassroomScene, type Rect, type View } from './scene.ts';
import type { PersonInRoom } from './people.ts';

export interface ZoomCommand {
  /** 0 = from the desk, 1 = the board fills the screen. */
  t: number;
  /** Bumped on every request, so asking for the same level again still applies. */
  n: number;
}

/**
 * The 3D classroom. When a board session is given, the live ink is drawn by a
 * hidden BoardRenderer and copied onto the board in the room after each redraw.
 * `children` are placed exactly over the board on screen (QR card, chips, pager).
 * With `pen`, the teacher writes straight onto the 3D board.
 */
export default function Classroom3D({
  view,
  board,
  people = [],
  teacherName = null,
  hideUid,
  showNames = false,
  seat = null,
  zoom,
  onZoom,
  pen,
  onPen,
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
  /** Student view: their seat number. */
  seat?: number | null;
  zoom?: ZoomCommand;
  onZoom?: (t: number) => void;
  /** Teacher view: current pen settings — enables writing on the 3D board. */
  pen?: () => PenSettings;
  onPen?: (p: PenInput | null) => void;
  onRenderer?: (r: BoardRenderer | null) => void;
  children?: ReactNode;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scene, setScene] = useState<ClassroomScene | null>(null);
  const [renderer, setRenderer] = useState<BoardRenderer | null>(null);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const cbs = useRef({ onRenderer, onPen, onZoom, pen });
  cbs.current = { onRenderer, onPen, onZoom, pen };

  // The scene itself.
  useEffect(() => {
    const sc = new ClassroomScene(hostRef.current!, view);
    sc.onBoardRect = setRect;
    sc.onZoom = (t) => cbs.current.onZoom?.(t);
    setScene(sc);
    return () => {
      sc.dispose();
      setScene(null);
    };
  }, [view]);

  // The live board, drawn off-screen at texture size and copied into the room.
  useEffect(() => {
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
    setRenderer(r);
    cbs.current.onRenderer?.(r);
    return () => {
      cbs.current.onRenderer?.(null);
      setRenderer(null);
      scene.setBoardSource(null);
      r.destroy();
      host.remove();
    };
  }, [scene, board]);

  // Teacher: the pen writes on the board in the room.
  const penEnabled = Boolean(pen);
  useEffect(() => {
    if (!penEnabled || !scene || !renderer || !overlay || !board) return;
    const pi = new PenInput(overlay, board, renderer, () => cbs.current.pen!(), { map: scene.boardPoint });
    cbs.current.onPen?.(pi);
    return () => {
      cbs.current.onPen?.(null);
      pi.destroy();
    };
  }, [penEnabled, scene, renderer, overlay, board]);

  useEffect(() => {
    scene?.setPeople(people, teacherName, hideUid);
  }, [scene, people, teacherName, hideUid]);

  useEffect(() => {
    scene?.setShowNames(showNames);
  }, [scene, showNames]);

  useEffect(() => {
    scene?.setSeat(seat);
  }, [scene, seat]);

  useEffect(() => {
    if (zoom) scene?.setZoom(zoom.t);
  }, [scene, zoom]);

  return (
    <div className={`room3d ${className}`} ref={hostRef}>
      {rect && (
        <div
          ref={setOverlay}
          className={`room3d__board ${penEnabled ? 'room3d__board--write' : ''}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
