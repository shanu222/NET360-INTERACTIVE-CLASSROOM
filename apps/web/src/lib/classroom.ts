import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { BoardSession } from '@net360/board-engine';
import type { ChatMessage, ChatSeen, ClassState, ClientToServer, PersonPublic, RosterEntry, ServerToClient, Welcome } from '@net360/protocol';
import { useAuth } from './auth.tsx';
import { API_URL } from './env.ts';

/** A chat message as shown on screen: sent ones may still be on their way. */
export type ChatItem = ChatMessage & { pending?: boolean; failed?: boolean; /** arrived while this screen was open */ live?: boolean };

export type Status = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface Classroom {
  status: Status;
  error: string | null;
  welcome: Welcome | null;
  cls: ClassState | null;
  roster: RosterEntry[];
  /** Everyone in the room (for the 3D classroom). */
  people: PersonPublic[];
  hand: boolean;
  /** Private messages this screen may see (own unsent ones included). */
  chats: ChatItem[];
  /** Read receipts, keyed `${by}|${peer}` → time read up to. */
  seen: Record<string, number>;
  /** Who is typing to me right now (uid → until when). */
  typing: Record<string, number>;
  /** Send a message now; it shows immediately and is confirmed by the server. */
  sendChat: (text: string, to?: string) => void;
  /** Try a failed message again. */
  retryChat: (cid: string) => void;
  /** Tell the other side I've read up to `at`. */
  markSeen: (at: number, peer?: string) => void;
  /** Let the other side know I'm typing. */
  sendTyping: (to?: string) => void;
  board: BoardSession;
  socket: Socket<ServerToClient, ClientToServer> | null;
}

/**
 * Connects one screen (teacher, student or board display) to a classroom.
 * The board session stays in sync across reconnects: on every (re)connect it
 * asks for what it missed and gets either the missing events or a snapshot.
 */
export function useClassroom(
  sessionId: string | undefined,
  opts: { boardKey?: string; padKey?: string; code?: string; enabled?: boolean; as?: 'teacher' | 'student'; guest?: { key: string; name: string } } = {},
): Classroom {
  const { socketAuth } = useAuth();
  const authRef = useRef(socketAuth);
  authRef.current = socketAuth;
  const clientId = useMemo(() => Math.random().toString(36).slice(2, 12), []);
  const board = useMemo(() => new BoardSession(clientId), [clientId]);
  const [socket, setSocket] = useState<Socket<ServerToClient, ClientToServer> | null>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const [cls, setCls] = useState<ClassState | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [people, setPeople] = useState<PersonPublic[]>([]);
  const [hand, setHand] = useState(false);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [seen, setSeen] = useState<Record<string, number>>({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const sockRef = useRef<Socket<ServerToClient, ClientToServer> | null>(null);
  const meRef = useRef<string>('');
  const chatsRef = useRef<ChatItem[]>([]);
  chatsRef.current = chats;
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const opts2: Partial<ManagerOptions & SocketOptions> = {
      parser: msgpackParser,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      // A function, so a fresh Firebase token is used on every reconnect.
      auth: (cb) => {
        // Students joining with name + code need no sign-in token.
        if (opts.guest) return cb({ sessionId, clientId, code: opts.code, as: 'student', guest: opts.guest });
        authRef
          .current()
          .then((a) => cb({ sessionId, clientId, boardKey: opts.boardKey, padKey: opts.padKey, code: opts.code, as: opts.as, ...a }))
          .catch(() => cb({ sessionId, clientId, boardKey: opts.boardKey, padKey: opts.padKey, code: opts.code, as: opts.as }));
      },
    };
    // Same origin in local dev; the Railway server's URL when split-hosted.
    const s: Socket<ServerToClient, ClientToServer> = API_URL ? io(API_URL, opts2) : io(opts2);
    let epoch: string | null = null;
    board.setTransport(
      (ev) => s.emit('b', ev),
      (seq) => s.emit('sync', seq),
    );

    s.on('connect', () => {
      setStatus('live');
      setError(null);
    });
    s.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') setStatus('reconnecting');
    });
    s.on('connect_error', (err) => {
      // Errors from the server's auth check are final; network errors retry.
      if (!s.active) {
        setError(err.message);
        setStatus('error');
      } else setStatus((st) => (st === 'live' ? 'reconnecting' : st));
    });
    s.on('welcome', (w) => {
      // A different epoch means the server restarted and restored the class from
      // its last saved snapshot: drop local state and take the server's board whole.
      if (epoch && epoch !== w.epoch) board.reset();
      epoch = w.epoch;
      board.resync();
      meRef.current = w.me.uid;
      setWelcome(w);
      setCls(w.cls);
    });
    s.on('snap', (st) => board.snapshot(st));
    s.on('tail', (evs) => board.tail(evs));
    s.on('b', (ev) => board.remote(ev));
    s.on('cls', setCls);
    s.on('roster', setRoster);
    s.on('people', setPeople);
    s.on('hand', setHand);
    // History replaces the list, but keeps messages still on their way.
    s.on('chatHistory', (h) =>
      setChats((c) => {
        const cids = new Set(h.map((m) => m.cid).filter(Boolean));
        return [...h, ...c.filter((m) => m.pending && !cids.has(m.id))];
      }),
    );
    s.on('chat', (raw) => {
      const m: ChatItem = { ...raw, live: true };
      setChats((c) => {
        if (c.some((x) => x.id === m.id)) return c;
        const i = m.cid ? c.findIndex((x) => x.pending && x.id === m.cid) : -1;
        if (i < 0) return [...c, m];
        const next = c.slice();
        next[i] = m;
        return next;
      });
      // A message arriving ends "typing…".
      setTyping((t) => (t[m.from] ? { ...t, [m.from]: 0 } : t));
    });
    s.on('chatSeen', (rs: ChatSeen[]) =>
      setSeen((v) => {
        const next = { ...v };
        for (const r of rs) next[`${r.by}|${r.peer}`] = Math.max(next[`${r.by}|${r.peer}`] ?? 0, r.at);
        return next;
      }),
    );
    s.on('typing', (from) => setTyping((t) => ({ ...t, [from]: Date.now() + 3500 })));
    s.on('ended', () => setStatus('ended'));
    s.on('fail', (m) => {
      setError(m);
      setStatus('error');
    });
    setSocket(s);
    sockRef.current = s;
    return () => {
      sockRef.current = null;
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [sessionId, enabled, opts.boardKey, opts.padKey, opts.code, opts.guest?.key, opts.guest?.name, board, clientId]);

  // Expire "typing…" on its own.
  useEffect(() => {
    const live = Object.values(typing).some((u) => u > Date.now());
    if (!live) return;
    const t = window.setTimeout(() => setTyping((v) => ({ ...v })), 600);
    return () => clearTimeout(t);
  }, [typing]);

  const actions = useMemo(() => {
    const emitChat = (m: ChatItem) => {
      sockRef.current?.emit('chat', { to: m.to || undefined, text: m.text, cid: m.id });
      // Not confirmed within 10 s (offline too long, or too many at once): offer a retry.
      window.setTimeout(() => setChats((c) => c.map((x) => (x.id === m.id && x.pending ? { ...x, failed: true } : x))), 10_000);
    };
    return {
      sendChat: (text: string, to?: string) => {
        const t = text.trim().slice(0, 1000);
        if (!t) return;
        const cid = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        const m: ChatItem = { id: cid, from: meRef.current, fromName: '', to: to ?? '', text: t, at: Date.now(), pending: true };
        setChats((c) => [...c, m]);
        emitChat(m);
      },
      retryChat: (cid: string) => {
        const m = chatsRef.current.find((x) => x.id === cid && x.pending);
        if (!m) return;
        setChats((c) => c.map((x) => (x.id === cid ? { ...x, failed: false } : x)));
        emitChat(m);
      },
      markSeen: (at: number, peer?: string) => sockRef.current?.emit('chatSeen', { peer, at }),
      sendTyping: (to?: string) => sockRef.current?.emit('typing', to),
    };
  }, []);

  return { status, error, welcome, cls, roster, people, hand, chats, seen, typing, ...actions, board, socket };
}
