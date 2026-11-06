import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@net360/protocol';
import type { ChatItem } from '../lib/classroom.ts';
import { Icon } from './Icons.tsx';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** One private conversation, live: instant send, ✓ sent, ✓✓ seen, and "typing…". */
export function ChatThread({
  messages,
  me,
  seenAt,
  typing,
  typingLabel,
  placeholder,
  empty,
  onSend,
  onRetry,
  onTyping,
  onSeen,
  autoFocus,
}: {
  messages: ChatItem[];
  me: string | undefined;
  /** The other person has read my messages up to this time. */
  seenAt: number;
  typing: boolean;
  typingLabel: string;
  placeholder: string;
  empty: string;
  onSend: (text: string) => void;
  onRetry: (cid: string) => void;
  onTyping: () => void;
  /** I've now read the other person's messages up to `at`. */
  onSeen: (at: number) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  // Reading the thread sends a read receipt for the newest message from the other side.
  const reported = useRef(0);
  const lastOther = useMemo(() => messages.reduce((a, m) => (m.from !== me && !m.pending ? Math.max(a, m.at) : a), 0), [messages, me]);
  useEffect(() => {
    if (lastOther > reported.current && document.visibilityState === 'visible') {
      reported.current = lastOther;
      onSeen(lastOther);
    }
    const vis = () => {
      if (document.visibilityState === 'visible' && lastOther > reported.current) {
        reported.current = lastOther;
        onSeen(lastOther);
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastOther]);

  // The last of my messages the other side has seen gets the "Seen" label.
  const lastSeenMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.from === me && !m.pending && m.at <= seenAt) return m.id;
    }
    return null;
  }, [messages, me, seenAt]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };
  return (
    <div className="chat">
      <div className="chat__list" ref={list}>
        {messages.length === 0 && <p className="chat__empty">{empty}</p>}
        {messages.map((m) => {
          const mine = m.from === me;
          const state = !mine ? null : m.failed ? 'failed' : m.pending ? 'sending' : m.at <= seenAt ? 'seen' : 'sent';
          return (
            <div key={m.id} className={`bubble ${mine ? 'bubble--me' : ''} ${m.pending ? 'is-pending' : ''} ${m.failed ? 'is-failed' : ''}`}>
              <span>{m.text}</span>
              <time>
                {time(m.at)}
                {state && (
                  <i className={`tick tick--${state}`} aria-label={state === 'seen' ? 'Seen' : state === 'sent' ? 'Sent' : state === 'sending' ? 'Sending' : 'Not sent'}>
                    {state === 'sending' ? '◷' : state === 'failed' ? '!' : state === 'seen' ? '✓✓' : '✓'}
                  </i>
                )}
              </time>
              {m.failed && (
                <button className="bubble__retry" onClick={() => onRetry(m.id)}>
                  Not sent · Tap to try again
                </button>
              )}
              {m.id === lastSeenMine && <em className="bubble__seen">Seen</em>}
            </div>
          );
        })}
        {typing && (
          <div className="bubble bubble--typing" aria-label={`${typingLabel} is typing`}>
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
      </div>
      <form
        className="chat__box"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          rows={1}
          value={text}
          maxLength={1000}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            if (e.target.value.trim()) onTyping();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" aria-label="Send" disabled={!text.trim()}>
          <Icon.send />
        </button>
      </form>
    </div>
  );
}

/**
 * Counts messages from others that arrived since a thread was last opened.
 * `open` is the thread currently on screen (it counts as read).
 */
export function useUnread(messages: ChatMessage[], me: string | undefined, keyOf: (m: ChatMessage) => string, open: string | null) {
  const [seen, setSeen] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open === null) return;
    const last = messages.filter((m) => keyOf(m) === open).at(-1)?.at ?? 0;
    setSeen((s) => (s[open] === last ? s : { ...s, [open]: last }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, messages]);
  return useMemo(() => {
    const out: Record<string, number> = {};
    let total = 0;
    for (const m of messages) {
      if (m.from === me) continue;
      const k = keyOf(m);
      if (k === open || m.at <= (seen[k] ?? 0)) continue;
      out[k] = (out[k] ?? 0) + 1;
      total++;
    }
    return { by: out, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, me, open, seen]);
}

/** Calls `onNew` for each message from someone else that arrives live (not old history). */
export function useIncoming(messages: ChatItem[], me: string | undefined, onNew: (m: ChatMessage) => void) {
  const known = useRef(new Set<string>());
  const cb = useRef(onNew);
  cb.current = onNew;
  useEffect(() => {
    for (const m of messages) {
      if (known.current.has(m.id)) continue;
      known.current.add(m.id);
      if (me && m.from !== me && m.live) cb.current(m);
    }
  }, [messages, me]);
}

/** A small pop-up for a message that arrived while the chat was closed. */
export function ChatPop({ msg, onOpen, onClose }: { msg: ChatMessage | null; onOpen: () => void; onClose: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(onClose, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg?.id]);
  if (!msg) return null;
  return (
    <button className="chatpop" onClick={onOpen}>
      <span className="chatpop__icon">
        <Icon.chat />
      </span>
      <span className="chatpop__text">
        <strong>{msg.fromName}</strong>
        <span>{msg.text}</span>
      </span>
    </button>
  );
}
