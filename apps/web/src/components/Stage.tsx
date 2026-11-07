import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PenHistory, PenInput, type BoardRenderer, type BoardSession, type PenSettings } from '@net360/board-engine';
import { boardView, type BoardView } from '@net360/protocol';
import { Board } from './Board.tsx';
import { Icon } from './Icons.tsx';

export type LiveView = BoardView & { page: number; pages: number };

/** What the class is looking at (mode, current slide and whiteboard page), kept up to date. */
export function useBoardView(board: BoardSession): LiveView {
  const read = (): LiveView => ({ ...boardView(board.state), page: board.state.page, pages: board.state.pages });
  const [v, setV] = useState(read);
  useEffect(() => {
    const up = () =>
      setV((prev) => {
        const n = read();
        return prev.mode === n.mode && prev.slide === n.slide && prev.wb === n.wb && prev.page === n.page && prev.pages === n.pages && prev.slides.length === n.slides.length
          ? prev
          : n;
      });
    up();
    const off = board.on((k) => k !== 'live' && up());
    return () => {
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);
  return v;
}

/**
 * Full screen for the stage. Where the browser can't (iPhone), the stage instead
 * covers the whole page.
 */
export function useFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [native, setNative] = useState(false);
  const [cover, setCover] = useState(false);
  useEffect(() => {
    const f = () => setNative(Boolean(ref.current) && document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);
  useEffect(() => {
    if (!cover) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCover(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [cover]);
  const toggle = () => {
    if (native) return void document.exitFullscreen().catch(() => undefined);
    if (cover) return setCover(false);
    const el = ref.current;
    if (el && document.fullscreenEnabled && el.requestFullscreen) void el.requestFullscreen().catch(() => setCover(true));
    else setCover(true);
  };
  return { ref, on: native || cover, cover, toggle };
}

type Half = 'slide' | 'wb';

/**
 * The flat board, as the class sees it: the whiteboard, the slides, or both side
 * by side. With `pen` (the teacher), each half can be written on.
 */
export function Stage({
  board,
  view,
  pen,
  onInput,
  onHistory,
  onPenDown,
  browse = false,
  overlay,
  onRenderer,
  showFull = true,
  className = '',
  boardClass = '',
}: {
  board: BoardSession;
  view: LiveView;
  /** Teacher: current pen settings (makes the board writable). */
  pen?: () => PenSettings;
  /** The pen of the half last written on (for undo / clear). */
  onInput?: (pi: PenInput | null) => void;
  onHistory?: (canUndo: boolean, canRedo: boolean) => void;
  onPenDown?: () => void;
  /** Students: flip through earlier pages on their own. */
  browse?: boolean;
  /** Shown over the whiteboard (join card, chips). */
  overlay?: ReactNode;
  /** The renderer of the main half (whiteboard, or the only one). */
  onRenderer?: (r: BoardRenderer | null) => void;
  showFull?: boolean;
  className?: string;
  /** Extra class on each board (e.g. the pen tool, for its cursor). */
  boardClass?: string;
}) {
  const fs = useFullscreen<HTMLDivElement>();
  // One viewer may enlarge one half of a split screen (only on their own screen).
  const [focus, setFocus] = useState<Half | null>(null);
  // Students browsing earlier pages: the page they are looking at instead of the live one.
  const [look, setLook] = useState<number | null>(null);
  useEffect(() => setLook(null), [view.mode]);
  useEffect(() => {
    if (view.mode !== 'split') setFocus(null);
  }, [view.mode]);

  const penRef = useRef(pen);
  penRef.current = pen;
  const writable = Boolean(pen);
  const [history] = useState(() => new PenHistory());
  const inputs = useRef<Partial<Record<Half, PenInput>>>({});
  const [active, setActive] = useState<Half | null>(null);
  const cbs = useRef({ onInput, onHistory, onPenDown, onRenderer });
  cbs.current = { onInput, onHistory, onPenDown, onRenderer };

  const split = view.mode === 'split' && !focus;
  const single: Half = view.mode === 'split' ? (focus ?? 'slide') : view.mode === 'slides' ? 'slide' : 'wb';
  const halves: Half[] = split ? ['slide', 'wb'] : [single];
  // The pen that undo and clear work on: the half last touched, else the one with the live page.
  const current: Half = split ? (active ?? (view.page === view.slide ? 'slide' : 'wb')) : single;

  const report = () => {
    const pi = inputs.current[current] ?? null;
    if (pi) pi.onHistory = (u, r) => cbs.current.onHistory?.(u, r);
    cbs.current.onInput?.(pi);
  };
  useEffect(report);

  const list = single === 'slide' ? view.slides : view.boards;
  const livePage = single === 'slide' ? view.slide : view.wb;
  const shown = look ?? livePage ?? 0;
  const at = list.indexOf(shown);

  return (
    <div ref={fs.ref} className={`stagev ${split ? 'stagev--split' : ''} ${!split && single === 'slide' ? 'stagev--slides' : ''} ${fs.on ? 'is-full' : ''} ${fs.cover ? 'stagev--cover' : ''} ${className}`}>
      {halves.map((half) => (
        <Pane
          key={half}
          half={half}
          board={board}
          look={!split && browse ? look : null}
          writable={writable}
          pen={() => penRef.current!()}
          history={history}
          onPen={(pi) => {
            if (pi) inputs.current[half] = pi;
            else delete inputs.current[half];
            report();
          }}
          onDown={() => {
            setActive(half);
            cbs.current.onPenDown?.();
          }}
          onRenderer={half === 'wb' || halves.length === 1 ? (r) => cbs.current.onRenderer?.(r) : undefined}
          label={
            view.mode === 'split' && (split || !browse)
              ? half === 'slide'
                ? `Slide ${view.slides.indexOf(view.slide ?? -1) + 1} / ${view.slides.length}`
                : `Whiteboard${view.boards.length > 1 ? ` ${view.boards.indexOf(view.wb ?? -1) + 1} / ${view.boards.length}` : ''}`
              : null
          }
          active={split && writable && current === half}
          boardClass={boardClass}
          action={
            view.mode === 'split' ? (
              split ? (
                <button className="stagev__btn" onClick={() => setFocus(half)} title="Show this half large" aria-label="Show this half large">
                  <Icon.expand />
                </button>
              ) : (
                <button className="stagev__btn stagev__btn--text" onClick={() => setFocus(null)} title="Back to side by side">
                  <Icon.split /> <span>Side by side</span>
                </button>
              )
            ) : null
          }
        >
          {(half === 'wb' || halves.length === 1) && overlay}
          {browse && !split && list.length > 1 && (
            <>
              {look !== null && look !== livePage && (
                <button className="chip chip--live stagev__live" onClick={() => setLook(null)}>
                  <span className="live-dot" /> Back to live
                </button>
              )}
              <div className="pager stagev__pager">
                <button aria-label="Previous page" disabled={at <= 0} onClick={() => setLook(list[at - 1])}>
                  <Icon.left />
                </button>
                <span>
                  {single === 'slide' ? 'Slide ' : ''}
                  {at + 1} / {list.length}
                </span>
                <button aria-label="Next page" disabled={at < 0 || at >= list.length - 1} onClick={() => setLook(list[at + 1])}>
                  <Icon.right />
                </button>
              </div>
            </>
          )}
        </Pane>
      ))}
      {showFull && (
        <button className="stagev__full" onClick={fs.toggle} title={fs.on ? 'Exit full screen' : 'Full screen'} aria-label={fs.on ? 'Exit full screen' : 'Full screen'}>
          {fs.on ? <Icon.shrink /> : <Icon.fullscreen />}
        </button>
      )}
    </div>
  );
}

function Pane({
  half,
  board,
  look,
  writable,
  pen,
  history,
  onPen,
  onDown,
  onRenderer,
  label,
  active,
  action,
  boardClass,
  children,
}: {
  boardClass: string;
  half: Half;
  board: BoardSession;
  look: number | null;
  writable: boolean;
  pen: () => PenSettings;
  history: PenHistory;
  onPen: (pi: PenInput | null) => void;
  onDown: () => void;
  onRenderer?: (r: BoardRenderer | null) => void;
  label: string | null;
  active: boolean;
  action: ReactNode;
  children?: ReactNode;
}) {
  const [r, setR] = useState<BoardRenderer | null>(null);
  const cbs = useRef({ onPen, onDown, onRenderer, pen });
  cbs.current = { onPen, onDown, onRenderer, pen };
  const lookRef = useRef(look);
  lookRef.current = look;

  // This half always shows its own page: the current slide, or the whiteboard.
  useEffect(() => {
    if (!r) return;
    r.setPin((s) => lookRef.current ?? (half === 'slide' ? boardView(s).slide : boardView(s).wb));
  }, [r, half, look]);

  useEffect(() => {
    if (!r) return;
    cbs.current.onRenderer?.(r);
    return () => cbs.current.onRenderer?.(null);
  }, [r]);

  useEffect(() => {
    if (!r || !writable) return;
    const host = r.live.parentElement;
    if (!host || !host.isConnected) return;
    const pi = new PenInput(host, board, r, () => cbs.current.pen(), { history });
    const down = () => cbs.current.onDown();
    host.addEventListener('pointerdown', down);
    cbs.current.onPen(pi);
    return () => {
      host.removeEventListener('pointerdown', down);
      pi.destroy();
      cbs.current.onPen(null);
    };
  }, [r, writable, board, history]);

  return (
    <div className={`stagev__pane stagev__pane--${half} ${active ? 'is-active' : ''}`}>
      <Board board={board} onRenderer={setR} writable={writable} className={boardClass}>
        {children}
        {label && <span className="stagev__label">{label}</span>}
        {action && <span className="stagev__actions">{action}</span>}
      </Board>
    </div>
  );
}

/**
 * Teacher: switch between the whiteboard, the slides and both side by side, and
 * move through slides and pages.
 */
export function ModeBar({
  board,
  view,
  onAddSlides,
  quiet = false,
  extra,
}: {
  board: BoardSession;
  view: LiveView;
  /** No slides yet: the Slides button asks for a file. */
  onAddSlides: () => void;
  quiet?: boolean;
  extra?: ReactNode;
}) {
  const has = view.slides.length > 0;
  const set = (m: BoardView['mode']) => board.local({ t: 'md', m });
  const go = (pg: number | undefined) => pg !== undefined && board.local({ t: 'pg', pg });
  const si = view.slides.indexOf(view.slide ?? -1);
  const bi = view.boards.indexOf(view.wb ?? -1);
  const showSlides = view.mode !== 'board' && has;
  const showBoards = view.mode !== 'slides';
  return (
    <div className={`modebar ${quiet ? 'is-quiet' : ''}`}>
      <div className="modebar__seg" role="tablist" aria-label="What the class sees">
        <button role="tab" aria-selected={view.mode === 'board'} className={view.mode === 'board' ? 'is-on' : ''} onClick={() => set('board')} title="Whiteboard (B)">
          <Icon.whiteboard /> <span>Whiteboard</span>
        </button>
        <button
          role="tab"
          aria-selected={view.mode === 'slides'}
          className={view.mode === 'slides' ? 'is-on' : ''}
          onClick={() => (has ? set('slides') : onAddSlides())}
          title={has ? 'Slides — write on them to explain (S)' : 'Add slides (PDF or images)'}
        >
          <Icon.slides /> <span>{has ? 'Slides' : 'Add slides'}</span>
        </button>
        <button
          role="tab"
          aria-selected={view.mode === 'split'}
          className={view.mode === 'split' ? 'is-on' : ''}
          disabled={!has}
          onClick={() => set('split')}
          title={has ? 'Slides and whiteboard side by side (D)' : 'Add slides first'}
        >
          <Icon.split /> <span>Side by side</span>
        </button>
      </div>
      {showSlides && (
        <div className="modebar__nav" aria-label="Slides">
          <button aria-label="Previous slide" disabled={si <= 0} onClick={() => go(view.slides[si - 1])}>
            <Icon.left />
          </button>
          <span>
            Slide {si + 1} / {view.slides.length}
          </span>
          <button aria-label="Next slide" disabled={si >= view.slides.length - 1} onClick={() => go(view.slides[si + 1])}>
            <Icon.right />
          </button>
        </div>
      )}
      {showBoards && (
        <div className="modebar__nav" aria-label="Whiteboard pages">
          {view.boards.length > 1 && (
            <button aria-label="Previous page" disabled={bi <= 0} onClick={() => go(view.boards[bi - 1])}>
              <Icon.left />
            </button>
          )}
          <span>
            Page {Math.max(1, bi + 1)} / {Math.max(1, view.boards.length)}
          </span>
          {view.boards.length > 1 && (
            <button aria-label="Next page" disabled={bi >= view.boards.length - 1} onClick={() => go(view.boards[bi + 1])}>
              <Icon.right />
            </button>
          )}
          <button aria-label="New page" title="New whiteboard page (N)" onClick={() => board.local({ t: 'pn' })}>
            <Icon.plus />
          </button>
        </div>
      )}
      {extra}
    </div>
  );
}
