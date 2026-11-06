import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { BoardSession } from '@net360/board-engine';
import type { ClassState, ClientToServer, RosterEntry, ServerToClient, Welcome } from '@net360/protocol';
import { useAuth } from './auth.tsx';

export type Status = 'connecting' | 'live' | 'reconnecting' | 'ended' | 'error';

export interface Classroom {
  status: Status;
  error: string | null;
  welcome: Welcome | null;
  cls: ClassState | null;
  roster: RosterEntry[];
  hand: boolean;
  board: BoardSession;
  socket: Socket<ServerToClient, ClientToServer> | null;
}

/**
 * Connects one screen (teacher, student or board display) to a classroom.
 * The board session stays in sync across reconnects: on every (re)connect it
 * asks for what it missed and gets either the missing events or a snapshot.
 */
export function useClassroom(sessionId: string | undefined, opts: { boardKey?: string; enabled?: boolean } = {}): Classroom {
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
  const [hand, setHand] = useState(false);
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const s: Socket<ServerToClient, ClientToServer> = io({
      parser: msgpackParser,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      // A function, so a fresh Firebase token is used on every reconnect.
      auth: (cb) => {
        authRef
          .current()
          .then((a) => cb({ sessionId, clientId, boardKey: opts.boardKey, ...a }))
          .catch(() => cb({ sessionId, clientId, boardKey: opts.boardKey }));
      },
    });
    board.setTransport(
      (ev) => s.emit('b', ev),
      (seq) => s.emit('sync', seq),
    );

    s.on('connect', () => {
      setStatus('live');
      setError(null);
      board.resync();
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
      setWelcome(w);
      setCls(w.cls);
    });
    s.on('snap', (st) => board.snapshot(st));
    s.on('tail', (evs) => board.tail(evs));
    s.on('b', (ev) => board.remote(ev));
    s.on('cls', setCls);
    s.on('roster', setRoster);
    s.on('hand', setHand);
    s.on('ended', () => setStatus('ended'));
    s.on('fail', (m) => {
      setError(m);
      setStatus('error');
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [sessionId, enabled, opts.boardKey, board, clientId]);

  return { status, error, welcome, cls, roster, hand, board, socket };
}
