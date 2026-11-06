import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@net360/protocol';
import { Icon } from './Icons.tsx';

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** One private conversation: messages plus a box to write in. */
export function ChatThread({
  messages,
  me,
  placeholder,
  empty,
  onSend,
  autoFocus,
}: {
  messages: ChatMessage[];
  me: string | undefined;
  placeholder: string;
  empty: string;
  onSend: (text: string) => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
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
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.from === me ? 'bubble--me' : ''}`}>
            <span>{m.text}</span>
            <time>{time(m.at)}</time>
          </div>
        ))}
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
          onChange={(e) => setText(e.target.value)}
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
