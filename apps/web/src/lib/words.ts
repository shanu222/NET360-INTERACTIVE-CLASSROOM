import type { SessionKind } from '@net360/protocol';

/**
 * Wording for a session: the host and participants, and "meeting" or "class"
 * depending on what the host created.
 */
export function words(kind: SessionKind | undefined) {
  const thing = kind === 'meeting' ? 'meeting' : 'class';
  return {
    thing,
    Thing: thing === 'meeting' ? 'Meeting' : 'Class',
    host: 'host',
    Host: 'Host',
    people: 'participants',
    People: 'Participants',
    count: (n: number) => `${n} ${n === 1 ? 'participant' : 'participants'}`,
  };
}
