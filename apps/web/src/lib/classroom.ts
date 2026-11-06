import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import msgpackParser from 'socket.io-msgpack-parser';
import { BoardSession } from '@net360/board-engine';
import type { ClassState, ClientToServer, PersonPublic, RosterEntry, ServerToClient, Welcome } from '@net360/protocol';
import { useAuth } from './auth.tsx';
import { API_URL } from './env.ts';

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
  opts: { boardKey?: string; enabled?: boolean; as?: 'teacher' | 'student' } = {},
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
        authRef
          .current()
          .then((a) => cb({ sessionId, clientId, boardKey: opts.boardKey, as: opts.as, ...a }))
          .catch(() => cb({ sessionId, clientId, boardKey: opts.boardKey, as: opts.as }));
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

  return { status, error, welcome, cls, roster, people, hand, board, socket };
}
