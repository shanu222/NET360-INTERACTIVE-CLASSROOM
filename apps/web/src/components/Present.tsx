import { useEffect, useRef, useState } from 'react';
import type { BoardSession } from '@net360/board-engine';
import type { ClientToServer, ServerToClient } from '@net360/protocol';
import type { Socket } from 'socket.io-client';
import type { ClassAudio } from '../lib/audio.ts';
import { makeSlides, SLIDE_TYPES } from '../lib/slides.ts';
import { Icon } from './Icons.tsx';

/**
 * Someone's shared screen, shown large for everyone. It can be shrunk to a corner
 * (to see the board) or made full screen.
 */
export function ScreenStage({
  screen,
  tv,
  onStop,
}: {
  screen: NonNullable<ClassAudio['screen']>;
  /** The classroom screen: always full, no controls. */
  tv?: boolean;
  /** Teacher: stop this presentation. */
  onStop?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    screen.track.attach(el);
    return () => {
      screen.track.detach(el);
    };
  }, [screen.track]);
  // A new presentation always opens large.
  useEffect(() => setSmall(false), [screen.track]);

  const full = () => {
    const el = box.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <div ref={box} className={`stage ${small ? 'stage--small' : ''} ${tv ? 'stage--tv' : ''}`} role="region" aria-label={`${screen.name}'s screen`}>
      {!tv && (
        <div className="stage__bar">
          <span className="stage__live" />
          <strong>{screen.name}</strong>
          <span className="stage__what">is presenting</span>
          <span className="stage__gap" />
          {onStop && !small && (
            <button className="stage__btn stage__btn--stop" onClick={onStop}>
              Stop
            </button>
          )}
          {!small && (
            <button className="stage__btn" onClick={full} aria-label="Full screen" title="Full screen">
              <Icon.expand />
            </button>
          )}
          <button
            className="stage__btn"
            onClick={() => setSmall((v) => !v)}
            aria-label={small ? 'Show large' : 'Shrink to the corner'}
            title={small ? 'Show large' : 'Shrink to the corner'}
          >
            {small ? <Icon.expand /> : <Icon.shrink />}
          </button>
        </div>
      )}
      <video ref={video} className="stage__video" autoPlay playsInline muted onDoubleClick={tv ? undefined : full} />
    </div>
  );
}

/** Turn a file into slides, upload them, and put them on the board. */
export function useSlideUpload(socket: Socket<ServerToClient, ClientToServer> | null, board: BoardSession) {
  const [progress, setProgress] = useState<{ done: number; total: number; step: 'read' | 'send' } | null>(null);
  const [error, setError] = useState('');
  const add = async (file: File) => {
    if (!socket || progress) return;
    setError('');
    try {
      setProgress({ done: 0, total: 1, step: 'read' });
      const images = await makeSlides(file, (done, total) => setProgress({ done, total, step: 'read' }));
      const imgs: string[] = [];
      for (const [i, data] of images.entries()) {
        setProgress({ done: i, total: images.length, step: 'send' });
        const r = await new Promise<{ img: string } | { error: string }>((res) => {
          const t = window.setTimeout(() => res({ error: 'The connection is slow. Please try again.' }), 30_000);
          // Send a plain ArrayBuffer: every message encoder carries it as binary.
          const bin = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
          socket.emit('slideUpload', bin as unknown as Uint8Array, (x) => {
            clearTimeout(t);
            res(x);
          });
        });
        if ('error' in r) throw new Error(r.error);
        imgs.push(r.img);
      }
      board.local({ t: 'sl', imgs });
    } catch (e) {
      setError((e as Error).message || 'Couldn’t add those slides.');
    } finally {
      setProgress(null);
    }
  };
  return { add, progress, error, clearError: () => setError('') };
}

/** "Add slides" button with a hidden file picker and progress. */
export function AddSlides({ upload, className = 'btn btn--ghost btn--sm' }: { upload: ReturnType<typeof useSlideUpload>; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const p = upload.progress;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={SLIDE_TYPES}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload.add(f);
        }}
      />
      <button className={className} disabled={Boolean(p)} onClick={() => input.current?.click()}>
        <Icon.slides />
        {p ? (p.step === 'read' ? `Preparing ${p.done}/${p.total}…` : `Sending ${p.done}/${p.total}…`) : 'Add slides'}
      </button>
    </>
  );
}

/** Previous / next slide for a student who is presenting (turns the class's page). */
export function SlideNav({ board }: { board: BoardSession }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const off = board.on(() => tick((n) => n + 1));
    return () => {
      off();
    };
  }, [board]);
  const { page, pages } = board.state;
  const go = (pg: number) => {
    if (pg >= 0 && pg < pages) board.local({ t: 'pg', pg });
  };
  return (
    <span className="slidenav">
      <button onClick={() => go(page - 1)} disabled={page <= 0} aria-label="Previous slide">
        <Icon.prev />
      </button>
      <span>
        {page + 1} / {pages}
      </span>
      <button onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Next slide">
        <Icon.next />
      </button>
    </span>
  );
}
