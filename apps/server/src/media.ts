import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { config, mediaEnabled } from './config.ts';

/**
 * Class audio through LiveKit (LiveKit Cloud or self-hosted — same settings).
 * The teacher always publishes; a student may publish their microphone only while
 * the teacher allows it. Permissions live in LiveKit itself, so a student's app
 * cannot get around a mute.
 */
const roomName = (sessionId: string) => `class-${sessionId}`;

const admin = mediaEnabled
  ? new RoomServiceClient(config.livekit.url.replace(/^ws/, 'http'), config.livekit.apiKey, config.livekit.apiSecret)
  : null;

/** What someone may send: their microphone, and/or their screen. */
export interface Allow {
  mic: boolean;
  screen: boolean;
}
export const sourcesFor = (a: Allow): TrackSource[] => [
  ...(a.mic ? [TrackSource.MICROPHONE] : []),
  ...(a.screen ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : []),
];

export async function mediaToken(opts: {
  sessionId: string;
  identity: string;
  name: string;
  allow: Allow;
  teacher: boolean;
}): Promise<{ url: string; token: string } | null> {
  if (!mediaEnabled) return null;
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: opts.identity,
    name: opts.name,
    ttl: '8h',
    attributes: { role: opts.teacher ? 'teacher' : 'student' },
  });
  at.addGrant({
    room: roomName(opts.sessionId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: opts.allow.mic || opts.allow.screen,
    canPublishSources: sourcesFor(opts.allow),
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { url: config.livekit.url, token: await at.toJwt() };
}

const notInRoom = (e: unknown) => /not found|not exist|404/i.test(String((e as Error)?.message ?? e));

/** Change what someone may send; anything no longer allowed is switched off at once. */
export async function setAllow(sessionId: string, identity: string, allow: Allow) {
  if (!admin) return;
  try {
    await admin.updateParticipant(roomName(sessionId), identity, undefined, {
      canSubscribe: true,
      canPublish: allow.mic || allow.screen,
      canPublishData: false,
      canPublishSources: sourcesFor(allow),
    });
    const off = [
      ...(allow.mic ? [] : [TrackSource.MICROPHONE]),
      ...(allow.screen ? [] : [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO]),
    ];
    if (off.length) await muteSources(sessionId, identity, off);
  } catch (e) {
    if (!notInRoom(e)) console.error('[media] permission change failed:', (e as Error).message);
  }
}

/** Switch off someone's microphone and/or screen share right now. */
async function muteSources(sessionId: string, identity: string, sources: TrackSource[]) {
  if (!admin) return;
  try {
    const p = await admin.getParticipant(roomName(sessionId), identity);
    for (const t of p.tracks) {
      if (sources.includes(t.source) && !t.muted) await admin.mutePublishedTrack(roomName(sessionId), identity, t.sid, true);
    }
  } catch (e) {
    if (!notInRoom(e)) console.error('[media] mute failed:', (e as Error).message);
  }
}

/** Everyone in the media room except the teacher. */
export async function mediaParticipants(sessionId: string): Promise<string[]> {
  if (!admin) return [];
  try {
    return (await admin.listParticipants(roomName(sessionId))).map((p) => p.identity);
  } catch {
    return [];
  }
}
