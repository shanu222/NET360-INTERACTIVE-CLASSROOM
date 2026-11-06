import { useEffect, useState } from 'react';
import type { BoardRenderer, BoardSession } from '@net360/board-engine';
import { pageStrokes } from '@net360/protocol';

/** True after `ms` without pointer or key activity — used to fade controls away. */
export function useIdle(ms = 3000) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let t = window.setTimeout(() => setIdle(true), ms);
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = window.setTimeout(() => setIdle(true), ms);
    };
    const evs = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    evs.forEach((e) => window.addEventListener(e, wake, { passive: true }));
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, wake));
    };
  }, [ms]);
  return idle;
}

export interface PageInfo {
  /** Page on screen. */
  page: number;
  /** Teacher's current page. */
  live: number;
  pages: number;
  following: boolean;
  /** Visible strokes on the page on screen. */
  inked: number;
}

/** Page position of a board view, kept current as events arrive. */
export function usePageInfo(board: BoardSession, renderer: BoardRenderer | null): PageInfo {
  const read = (): PageInfo => {
    const s = board.state;
    const page = renderer?.page ?? s.page;
    return { page, live: s.page, pages: s.pages, following: page === s.page, inked: pageStrokes(s, page).length };
  };
  const [info, setInfo] = useState<PageInfo>(read);
  useEffect(() => {
    const update = () =>
      setInfo((prev) => {
        const n = read();
        return prev.page === n.page && prev.live === n.live && prev.pages === n.pages && prev.following === n.following && prev.inked === n.inked ? prev : n;
      });
    update();
    const off = board.on((kind) => kind !== 'live' && update());
    if (renderer) renderer.onPageView = update;
    return () => {
      off();
      if (renderer) renderer.onPageView = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, renderer]);
  return info;
}

/** Keep a display awake (classroom board). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock.request('screen').then((l) => (lock = l)).catch(() => {});
    get();
    const vis = () => document.visibilityState === 'visible' && get();
    document.addEventListener('visibilitychange', vis);
    return () => {
      document.removeEventListener('visibilitychange', vis);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
