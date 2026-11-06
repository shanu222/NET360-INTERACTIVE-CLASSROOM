import { useEffect, useRef, type ReactNode } from 'react';
import { BoardRenderer, type BoardSession } from '@net360/board-engine';

/**
 * The slate: an oak-framed glass board. Strokes render on two canvases inside
 * `.slate__ink`; overlays (QR card, spotlight, chips) go in `children`.
 */
export function Board({
  board,
  onRenderer,
  children,
  writable = false,
  className = '',
}: {
  board: BoardSession;
  onRenderer?: (r: BoardRenderer | null) => void;
  children?: ReactNode;
  writable?: boolean;
  className?: string;
}) {
  const ink = useRef<HTMLDivElement>(null);
  const cb = useRef(onRenderer);
  cb.current = onRenderer;

  useEffect(() => {
    const r = new BoardRenderer(ink.current!, board);
    cb.current?.(r);
    return () => {
      cb.current?.(null);
      r.destroy();
    };
  }, [board]);

  return (
    <div className={`slate ${writable ? 'slate--writable' : ''} ${className}`}>
      <div className="slate__glass" />
      <div className="slate__ink" ref={ink} />
      {children}
    </div>
  );
}
