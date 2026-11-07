import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { SessionInfo } from '@net360/protocol';
import { Icon } from './Icons.tsx';
import { words } from '../lib/words.ts';

/** "1 h 12 min", "24 min", "less than a minute". */
export function duration(from: number, to: number) {
  const min = Math.round((to - from) / 60_000);
  if (min < 1) return 'less than a minute';
  const h = Math.floor(min / 60);
  return h ? `${h} h ${min % 60} min` : `${min} min`;
}

/**
 * The end of a meeting, the way video-call apps show it: a short notice slides in
 * from the top, and a card says it's over, for how long it ran, and what you can
 * do now (keep the notes, go home).
 */
export function Ended({
  info,
  at,
  live,
  host,
  hasNotes,
  saving,
  onSave,
  onHome,
  onNew,
}: {
  info: SessionInfo | undefined;
  /** When it ended (or when this screen found out). */
  at: number;
  /** This screen was in the meeting when it ended (not opened afterwards). */
  live: boolean;
  /** The host's own screen. */
  host: boolean;
  hasNotes: boolean;
  saving: boolean;
  onSave: () => void;
  onHome: () => void;
  /** Host: start another meeting. */
  onNew?: () => void;
}) {
  const w = words(info?.kind);
  const [notice, setNotice] = useState(live);
  useEffect(() => {
    // Leave full screen so the message is seen.
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    const t = window.setTimeout(() => setNotice(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const title = host ? `You ended the ${w.thing}` : live ? `The host ended this ${w.thing}` : `This ${w.thing} has ended`;
  const by = host ? 'for everyone' : info?.teacherName ? `by ${info.teacherName}` : 'by the host';

  return (
    <>
      <AnimatePresence>
        {notice && (
          <motion.div
            className="endnote"
            role="status"
            aria-live="assertive"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="endnote__icon">
              <Icon.callEnd />
            </span>
            <span>
              <strong>{w.Thing} ended</strong> {by}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="veil veil--ended">
        <motion.div
          className="veil__card ended"
          role="dialog"
          aria-labelledby="ended-title"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          <span className="ended__icon">
            <Icon.callEnd />
          </span>
          <h2 id="ended-title">{title}</h2>
          {info && (
            <p className="ended__meta">
              <strong>{info.subject}</strong>
              {live && <span>Lasted {duration(info.startedAt, at)}</span>}
            </p>
          )}
          <p>
            {hasNotes
              ? 'The whiteboard and slides are no longer kept online. Save them now to keep a copy on this device.'
              : `Thanks for joining. Nothing from this ${w.thing} is kept online.`}
          </p>
          {hasNotes && (
            <button className="btn btn--primary btn--wide" disabled={saving} onClick={onSave}>
              <Icon.download /> {saving ? 'Preparing PDF…' : 'Save notes as PDF'}
            </button>
          )}
          {host && onNew && (
            <button className={`btn ${hasNotes ? 'btn--ghost' : 'btn--primary'} btn--wide`} onClick={onNew}>
              <Icon.video /> Start a new {w.thing}
            </button>
          )}
          <button className={`btn ${hasNotes || (host && onNew) ? 'btn--ghost' : 'btn--primary'} btn--wide`} onClick={onHome}>
            <Icon.home /> Back to home
          </button>
        </motion.div>
      </div>
    </>
  );
}
