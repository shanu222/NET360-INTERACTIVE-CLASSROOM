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

export async function mediaToken(opts: {
  sessionId: string;
  identity: string;
  name: string;
  canPublish: boolean;
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
    canPublish: opts.canPublish,
    canPublishSources: [TrackSource.MICROPHONE],
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { url: config.livekit.url, token: await at.toJwt() };
}

const notInRoom = (e: unknown) => /not found|not exist|404/i.test(String((e as Error)?.message ?? e));

/** Let someone speak, or take it away (their microphone is switched off too). */
export async function setSpeak(sessionId: string, identity: string, allow: boolean) {
  if (!admin) return;
  try {
    await admin.updateParticipant(roomName(sessionId), identity, undefined, {
      canSubscribe: true,
      canPublish: allow,
      canPublishData: false,
      canPublishSources: [TrackSource.MICROPHONE],
    });
    if (!allow) await muteMic(sessionId, identity);
  } catch (e) {
    if (!notInRoom(e)) console.error('[audio] permission change failed:', (e as Error).message);
  }
}

/** Switch off someone's microphone right now. */
export async function muteMic(sessionId: string, identity: string) {
  if (!admin) return;
  try {
    const p = await admin.getParticipant(roomName(sessionId), identity);
    for (const t of p.tracks) {
      if (t.source === TrackSource.MICROPHONE && !t.muted) await admin.mutePublishedTrack(roomName(sessionId), identity, t.sid, true);
    }
  } catch (e) {
    if (!notInRoom(e)) console.error('[audio] mute failed:', (e as Error).message);
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
