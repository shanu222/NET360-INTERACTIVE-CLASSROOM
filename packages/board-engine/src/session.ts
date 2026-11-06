import {
  applyEvent,
  emptyBoard,
  type BoardEvent,
  type BoardEventBody,
  type BoardState,
} from '@net360/protocol';

export type ChangeKind = 'live' | 'structural' | 'reset';
export type ChangeListener = (kind: ChangeKind, strokeId?: string) => void;

/**
 * Client-side board state, kept identical to the server's by applying the
 * same ordered events. Handles:
 *  - optimistic local writes (the writer never waits for the network),
 *  - skipping its own echoes,
 *  - buffering events until the first sync completes,
 *  - detecting gaps and asking the server to fill them.
 */
export class BoardSession {
  state: BoardState = emptyBoard();
  synced = false;
  private pending: BoardEvent[] = [];
  private listeners = new Set<ChangeListener>();

  constructor(
    public clientId: string,
    /** Sends a locally created event to the server. */
    private send: (ev: BoardEventBody) => void = () => {},
    /** Asks the server for everything after `lastSeq`. */
    private requestSync: (lastSeq: number) => void = () => {},
  ) {}

  setTransport(send: (ev: BoardEventBody) => void, requestSync: (lastSeq: number) => void) {
    this.send = send;
    this.requestSync = requestSync;
  }

  on(fn: ChangeListener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(kind: ChangeKind, id?: string) {
    for (const fn of this.listeners) fn(kind, id);
  }

  /** Call after (re)connecting: asks for what this client has missed. */
  resync() {
    this.synced = false;
    this.requestSync(this.state.seq > 0 ? this.state.seq : -1);
  }

  /** A locally drawn event: show it now, send it, let the echo only advance seq. */
  local(ev: BoardEventBody) {
    const r = applyEvent(this.state, ev);
    this.send(ev);
    if (r.structural) this.notify('structural');
    else if (r.live) this.notify('live', r.live);
  }

  /** Full board from the server. */
  snapshot(s: BoardState) {
    this.state = s;
    this.synced = true;
    this.drainPending();
    this.notify('reset');
  }

  /** Missed events from the server. */
  tail(evs: BoardEvent[]) {
    for (const ev of evs) this.applyOrdered(ev, false);
    this.synced = true;
    this.drainPending();
    this.notify('reset');
  }

  /** A live event broadcast by the server. */
  remote(ev: BoardEvent) {
    if (!this.synced) {
      this.pending.push(ev);
      return;
    }
    if (ev.seq <= this.state.seq) return; // already have it
    if (ev.seq > this.state.seq + 1) {
      // A gap: something was missed. Hold this and fetch the gap.
      this.pending.push(ev);
      this.synced = false;
      this.requestSync(this.state.seq);
      return;
    }
    this.applyOrdered(ev, true);
  }

  private drainPending() {
    const evs = this.pending.sort((a, b) => a.seq - b.seq);
    this.pending = [];
    for (const ev of evs) {
      if (ev.seq === this.state.seq + 1) this.applyOrdered(ev, false);
      else if (ev.seq > this.state.seq + 1) {
        // Still a gap: keep the rest and ask again.
        this.pending = evs.filter((e) => e.seq >= ev.seq);
        this.synced = false;
        this.requestSync(this.state.seq);
        return;
      }
    }
  }

  private applyOrdered(ev: BoardEvent, notify: boolean) {
    if (ev.seq <= this.state.seq) return;
    if (ev.o === this.clientId) {
      // Our own event, already drawn when we created it.
      this.state.seq = ev.seq;
      return;
    }
    const r = applyEvent(this.state, ev);
    if (!notify) return;
    if (r.structural) this.notify('structural');
    else if (r.live) this.notify('live', r.live);
  }
}
